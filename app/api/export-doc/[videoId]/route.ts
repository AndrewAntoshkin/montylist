import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Document, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle, HeadingLevel } from 'docx';

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
          children: [
            // Title Page
            new Paragraph({
              text: 'МОНТАЖНЫЕ ЛИСТЫ',
              alignment: AlignmentType.CENTER,
              spacing: { before: 4000, after: 400 },
              style: 'Heading1',
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: video.original_filename || 'Название фильма',
                  italics: true,
                  size: 28,
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 6000 },
            }),
            new Paragraph({
              text: '',
              spacing: { after: 8000 },
            }),
            new Paragraph({
              text: 'Фирма-производитель – ',
              spacing: { before: 6000 },
            }),
          ],
        },
        {
          children: [
            // Film Information Section
            new Paragraph({
              text: 'Год выпуска – ',
            }),
            new Paragraph({
              text: 'Страна производства – ',
            }),
            new Paragraph({
              text: 'Автор (ы) сценария – ',
            }),
            new Paragraph({
              text: 'Режиссер-постановщик – ',
            }),
            new Paragraph({
              text: 'Правообладатель (и) – ',
            }),
            new Paragraph({
              text: 'Продолжительность фильма ',
            }),
            new Paragraph({
              text: 'Количество серий – ',
            }),
            new Paragraph({
              text: 'Формат кадра',
            }),
            new Paragraph({
              text: 'Цветной / черно-белый – ',
            }),
            new Paragraph({
              text: 'Носитель информации – ',
            }),
            new Paragraph({
              text: 'Язык оригинала – ',
            }),
            new Paragraph({
              text: 'Язык надписей – ',
            }),
            new Paragraph({
              text: 'Язык фонограммы – ',
            }),
            new Paragraph({
              text: '',
              spacing: { after: 400 },
            }),
          ],
        },
        {
          children: [
            // Montage Table
            new Table({
              width: {
                size: 100,
                type: WidthType.PERCENTAGE,
              },
              rows: [
                // Header Row
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          text: '№ плана',
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 8, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          text: 'Начальный тайм-код плана (часы: мин.: сек.: кадры)',
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 12, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          text: 'Конечный тайм-код плана (часы: мин.: сек.: кадры)',
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 12, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          text: 'Вид плана',
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 10, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          text: 'Содержание (описание) плана, титры',
                          alignment: AlignmentType.CENTER,
                        }),
                      ],
                      width: { size: 28, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          text: 'Монологи, разговоры, песни, субтитры Музыка.',
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
                              text: entry.plan_number.toString(),
                              alignment: AlignmentType.CENTER,
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({
                              text: entry.start_timecode,
                              alignment: AlignmentType.CENTER,
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({
                              text: entry.end_timecode,
                              alignment: AlignmentType.CENTER,
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({
                              text: entry.plan_type || '',
                              alignment: AlignmentType.CENTER,
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [new Paragraph(entry.description || '')],
                        }),
                        new TableCell({
                          children: [new Paragraph(entry.dialogues || '')],
                        }),
                      ],
                    })
                ),
              ],
            }),
            new Paragraph({
              text: '',
              spacing: { before: 800, after: 400 },
            }),
            new Paragraph({
              text: 'Монтажные листы соответствуют копии фильма, принятого к выпуску на экран.',
            }),
            new Paragraph({
              text: '',
              spacing: { after: 800 },
            }),
            new Paragraph({
              text: 'Руководитель организации ____________  ________________  ____________',
            }),
            new Paragraph({
              text: '',
              spacing: { after: 1600 },
            }),
            new Paragraph({
              text: '                          подпись       расшифровка подписи      дата',
            }),
            new Paragraph({
              text: '                                                М.П.',
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
    return new NextResponse(buffer, {
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

