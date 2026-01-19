#!/usr/bin/env python3
"""
Voice Embedding Worker — Создание голосовых отпечатков для точной идентификации персонажей

Использует resemblyzer для создания voice embeddings и сравнения голосов.

Алгоритм:
1. Извлекаем аудио-фрагменты для каждого speaker ID из видео
2. Создаём embeddings для каждого speaker
3. Сравниваем с эталонными голосами (если есть)
4. Возвращаем уточнённый speaker→character mapping

@author AI Assistant
@version 1.0
"""

import sys
import os
import json
import subprocess
import tempfile
from pathlib import Path

# Проверяем зависимости
try:
    import numpy as np
    from resemblyzer import VoiceEncoder, preprocess_wav
except ImportError as e:
    print(f"❌ Missing dependency: {e}", file=sys.stderr)
    print("Run: pip3 install resemblyzer numpy", file=sys.stderr)
    sys.exit(1)


def extract_audio_segment(video_path: str, start_ms: int, end_ms: int, output_path: str) -> bool:
    """Извлекает аудио-сегмент из видео"""
    start_sec = start_ms / 1000
    duration = (end_ms - start_ms) / 1000
    
    cmd = [
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', str(start_sec),
        '-i', video_path,
        '-t', str(duration),
        '-vn',  # Без видео
        '-acodec', 'pcm_s16le',
        '-ar', '16000',  # 16kHz для resemblyzer
        '-ac', '1',  # Моно
        output_path
    ]
    
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return os.path.exists(output_path) and os.path.getsize(output_path) > 1000
    except subprocess.CalledProcessError:
        return False


def create_speaker_embeddings(video_path: str, diarization_words: list) -> dict:
    """
    Создаёт voice embeddings для каждого speaker ID
    
    Args:
        video_path: Путь к видео файлу
        diarization_words: Список слов с speaker ID и таймкодами
        
    Returns:
        Dict[speaker_id, embedding (list of floats)]
    """
    print("🎤 Creating voice embeddings...")
    
    encoder = VoiceEncoder()
    speaker_embeddings = {}
    speaker_segments = {}
    
    # Группируем слова по speaker ID
    for word in diarization_words:
        speaker = word.get('speaker', 'UNKNOWN')
        if speaker == 'UNKNOWN':
            continue
            
        if speaker not in speaker_segments:
            speaker_segments[speaker] = []
        
        speaker_segments[speaker].append({
            'start': word.get('startMs', word.get('start', 0)),
            'end': word.get('endMs', word.get('end', 0)),
            'text': word.get('text', word.get('word', ''))
        })
    
    print(f"   Found {len(speaker_segments)} speakers")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        for speaker_id, segments in speaker_segments.items():
            # Берём первые 10 сегментов (достаточно для хорошего embedding)
            sample_segments = segments[:10]
            
            # Объединяем близкие сегменты для лучшего качества
            merged_segments = []
            current = None
            
            for seg in sorted(sample_segments, key=lambda x: x['start']):
                if current is None:
                    current = seg.copy()
                elif seg['start'] - current['end'] < 500:  # < 500ms gap
                    current['end'] = seg['end']
                    current['text'] += ' ' + seg['text']
                else:
                    if current['end'] - current['start'] > 500:  # > 500ms
                        merged_segments.append(current)
                    current = seg.copy()
            
            if current and current['end'] - current['start'] > 500:
                merged_segments.append(current)
            
            if not merged_segments:
                print(f"   ⚠️  Speaker {speaker_id}: no valid segments")
                continue
            
            # Извлекаем аудио и создаём embeddings
            embeddings = []
            
            for i, seg in enumerate(merged_segments[:5]):  # Макс 5 сегментов
                audio_path = os.path.join(temp_dir, f"{speaker_id}_{i}.wav")
                
                if extract_audio_segment(video_path, seg['start'], seg['end'], audio_path):
                    try:
                        wav = preprocess_wav(audio_path)
                        if len(wav) > 0:
                            embedding = encoder.embed_utterance(wav)
                            embeddings.append(embedding)
                    except Exception as e:
                        print(f"   ⚠️  Error processing {speaker_id}_{i}: {e}")
            
            if embeddings:
                # Усредняем embeddings для этого speaker
                avg_embedding = np.mean(embeddings, axis=0)
                speaker_embeddings[speaker_id] = avg_embedding.tolist()
                print(f"   ✅ Speaker {speaker_id}: {len(embeddings)} segments → embedding created")
            else:
                print(f"   ⚠️  Speaker {speaker_id}: failed to create embedding")
    
    return speaker_embeddings


def compare_speakers(embeddings1: dict, embeddings2: dict) -> dict:
    """
    Сравнивает два набора speaker embeddings
    
    Returns:
        Dict с similarity scores между speakers
    """
    from numpy.linalg import norm
    
    similarities = {}
    
    for speaker1, emb1 in embeddings1.items():
        emb1 = np.array(emb1)
        similarities[speaker1] = {}
        
        for speaker2, emb2 in embeddings2.items():
            emb2 = np.array(emb2)
            # Cosine similarity
            similarity = np.dot(emb1, emb2) / (norm(emb1) * norm(emb2))
            similarities[speaker1][speaker2] = float(similarity)
    
    return similarities


def find_best_matches(similarities: dict, threshold: float = 0.75) -> dict:
    """
    Находит лучшие совпадения между speakers
    
    Args:
        similarities: Матрица похожести
        threshold: Минимальный порог для совпадения
        
    Returns:
        Dict[speaker_id, (matched_character, confidence)]
    """
    matches = {}
    
    for speaker, scores in similarities.items():
        best_match = max(scores.items(), key=lambda x: x[1])
        if best_match[1] >= threshold:
            matches[speaker] = {
                'character': best_match[0],
                'confidence': best_match[1],
                'method': 'voice_embedding'
            }
    
    return matches


def main():
    """Основная функция worker'а"""
    if len(sys.argv) < 3:
        print("Usage: voice-embedding-worker.py <video_path> <diarization_json>", file=sys.stderr)
        sys.exit(1)
    
    video_path = sys.argv[1]
    diarization_json = sys.argv[2]
    reference_json = sys.argv[3] if len(sys.argv) > 3 else None
    
    print("\n" + "═" * 60)
    print("🎤 VOICE EMBEDDING WORKER")
    print("═" * 60)
    print(f"   Video: {os.path.basename(video_path)}")
    
    # Загружаем данные диаризации
    with open(diarization_json, 'r') as f:
        diarization_words = json.load(f)
    
    print(f"   Words: {len(diarization_words)}")
    
    # Создаём embeddings
    speaker_embeddings = create_speaker_embeddings(video_path, diarization_words)
    
    result = {
        'embeddings': speaker_embeddings,
        'speaker_count': len(speaker_embeddings)
    }
    
    # Если есть эталонные голоса — сравниваем
    if reference_json and os.path.exists(reference_json):
        print("\n📊 Comparing with reference voices...")
        with open(reference_json, 'r') as f:
            reference_embeddings = json.load(f)
        
        similarities = compare_speakers(speaker_embeddings, reference_embeddings)
        matches = find_best_matches(similarities)
        
        result['similarities'] = similarities
        result['matches'] = matches
        
        print("\n   Best matches:")
        for speaker, match in matches.items():
            print(f"      {speaker} → {match['character']} ({match['confidence']:.0%})")
    
    # Выводим результат
    print("\n" + "═" * 60)
    print("📊 VOICE EMBEDDING COMPLETE")
    print("═" * 60)
    print(f"   Speakers processed: {len(speaker_embeddings)}")
    
    # Отправляем результат через stdout (JSON)
    print("\n__RESULT_JSON__")
    print(json.dumps(result))


if __name__ == '__main__':
    main()
