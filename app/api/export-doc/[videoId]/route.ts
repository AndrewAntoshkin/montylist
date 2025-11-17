import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Document, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle, PageOrientation, PageBreak } from 'docx';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  try {
    const { videoId } = await params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch video
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', user.id)
      .single();

    if (videoError || !video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Fetch montage sheet
    const { data: sheet, error: sheetError } = await supabase
      .from('montage_sheets')
      .select('*')
      .eq('video_id', videoId)
      .single();

    if (sheetError || !sheet) {
      return NextResponse.json(
        { error: 'Montage sheet not found' },
        { status: 404 }
      );
    }

    // Fetch entries
    const { data: entries, error: entriesError } = await supabase
      .from('montage_entries')
      .select('*')
      .eq('sheet_id', sheet.id)
      .order('order_index', { ascending: true });

    if (entriesError) {
      return NextResponse.json(
        { error: 'Failed to fetch entries' },
        { status: 500 }
      );
    }

    // Create Word document
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              // Landscape orientation - A4 landscape
              size: {
                width: 16838,  // 29.7 cm in twips
                height: 11906, // 21 cm in twips
                orientation: PageOrientation.LANDSCAPE,
              },
              margin: {
                top: 850,    // ~1.5cm
                bottom: 850, // ~1.5cm
                left: 850,   // 1.5cm
                right: 850,  // 1.5cm
              },
            },
          },
          children: [
            // Title: МОНТАЖНЫЙ ЛИСТ - 30pt centered
            new Paragraph({
              children: [
                new TextRun({
                  text: 'МОНТАЖНЫЕ ЛИСТЫ',
                  size: 60, // 30pt * 2
                  bold: true,
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 400, after: 400 },
            }),
            
            // Empty line 1
            new Paragraph({
              text: '',
              spacing: { after: 200 },
            }),
            
            // Empty line 2
            new Paragraph({
              text: '',
              spacing: { after: 200 },
            }),
            
            // Video name - 16pt centered, capitalized first letter
            new Paragraph({
              children: [
                new TextRun({
                  text: (video.original_filename || 'Название видео').charAt(0).toUpperCase() + (video.original_filename || 'Название видео').slice(1),
                  size: 32, // 16pt * 2
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            }),
            
            // Empty line 3
            new Paragraph({
              text: '',
              spacing: { after: 200 },
            }),
            
            // Empty line 4
            new Paragraph({
              text: '',
              spacing: { after: 200 },
            }),
            
            // Film information - 14pt left aligned
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Фирма-производитель – ',
                  size: 28, // 14pt * 2
                }),
                new TextRun({
                  text: video.film_metadata_json?.producer_company || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Год выпуска – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.release_year || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Страна производства – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.country || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Автор (ы) сценария – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.screenwriter || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Режиссер-постановщик – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.director || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Правообладатель (и) – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.copyright_holder || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Продолжительность фильма ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.duration_text || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Количество серий – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.episodes_count || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Формат кадра ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.frame_format || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Цветной / черно-белый – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.color_format || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Носитель информации – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.media_carrier || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Язык оригинала – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.original_language || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Язык надписей – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.subtitles_language || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Язык фонограммы – ',
                  size: 28,
                }),
                new TextRun({
                  text: video.film_metadata_json?.audio_language || '',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 400 },
            }),
            
            // Page break - table starts on second page
            new Paragraph({
              children: [new PageBreak()],
            }),
            
            // Montage Table - 10pt, full width
            new Table({
              width: {
                size: 100,
                type: WidthType.PERCENTAGE,
              },
              columnWidths: [1000, 1500, 1500, 1200, 3400, 3500], // Proportional widths in DXA units
              rows: [
                // Header Row
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: '№ плана',
                              size: 20, // 10pt * 2
                            }),
                          ],
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 8, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: 'Начальный тайм-код плана (часы: мин.: сек.: кадры)',
                              size: 20,
                            }),
                          ],
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 12, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: 'Конечный тайм-код плана (часы: мин.: сек.: кадры)',
                              size: 20,
                            }),
                          ],
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 12, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: 'Вид плана',
                              size: 20,
                            }),
                          ],
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 10, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: 'Содержание (описание) плана, титры',
                              size: 20,
                            }),
                          ],
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 28, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: 'Монологи, разговоры, песни, субтитры Музыка.',
                              size: 20,
                            }),
                          ],
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 30, type: WidthType.PERCENTAGE },
                    }),
                  ],
                }),
                // Data Rows
                ...(entries || []).map(
                  (entry) =>
                    new TableRow({
                      children: [
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: entry.plan_number.toString(),
                                  size: 20,
                                }),
                              ],
                              alignment: AlignmentType.CENTER,
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: entry.start_timecode,
                                  size: 20,
                                }),
                              ],
                              alignment: AlignmentType.CENTER,
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: entry.end_timecode,
                                  size: 20,
                                }),
                              ],
                              alignment: AlignmentType.CENTER,
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: entry.plan_type || '',
                                  size: 20,
                                }),
                              ],
                              alignment: AlignmentType.CENTER,
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: entry.description || '',
                                  size: 20,
                                }),
                              ],
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: entry.dialogues || '',
                                  size: 20,
                                }),
                              ],
                            }),
                          ],
                        }),
                      ],
                    })
                ),
              ],
            }),
            
            // Footer section - 14pt
            new Paragraph({
              text: '',
              spacing: { before: 600, after: 400 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Монтажные листы соответствуют копии фильма, принятого к выпуску на экран.',
                  size: 28, // 14pt * 2
                }),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 400 },
            }),
            new Paragraph({
              text: '',
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Руководитель организации ____________  ____________________  ____________',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: '                                                       подпись             расшифровка подписи   дата',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: '                                                                                                                                                                                 М.П.',
                  size: 28,
                }),
              ],
              alignment: AlignmentType.LEFT,
            }),
          ],
        },
      ],
    });

    // Generate Word file buffer
    const { Packer } = await import('docx');
    const buffer = await Packer.toBuffer(doc);

    // Create safe filename
    const safeFilename = `montage_${videoId.substring(0, 8)}.docx`;

    // Return as downloadable file
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
      },
    });
  } catch (error) {
    console.error('Export DOC error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


