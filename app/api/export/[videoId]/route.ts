import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

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

    // Create Excel workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel with film information section
    const data = [
      // Film Information Header
      ['Информация о фильме.'],
      [], // Empty row
      
      // Film Information Table (2 columns: label and value)
      ['Название', ''],
      ['Фирма-производитель', ''],
      ['Год выпуска', ''],
      ['Страна производства', ''],
      ['Правообладатель(и)', ''],
      ['Продолжительность фильма', ''],
      ['Количество серий', ''],
      ['Формат кадра', ''],
      ['Цветной / черно-белый', ''],
      ['Носитель информации', ''],
      ['Язык оригинала', ''],
      ['Язык надписей', ''],
      ['Язык фонограммы', ''],
      ['Автор(ы) сценария', ''],
      ['Режиссер(ы)', ''],
      ['Оператор(ы)', ''],
      ['Композитор(ы)', ''],
      
      [], // Empty row separator
      [], // Empty row separator
      
      // Montage Table Header
      [
        '№ плана',
        'Начальный тайм-код',
        'Конечный тайм-код',
        'План',
        'Содержание (описание) плана, титры',
        'Монологи, разговоры, песни, субтитры, музыка',
      ],
      // Montage Data rows
      ...(entries || []).map((entry) => [
        entry.plan_number,
        entry.start_timecode,
        entry.end_timecode,
        entry.plan_type || '',
        entry.description || '',
        entry.dialogues || '',
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    
    // Ensure empty cells exist for film info values (column B)
    // This is needed for borders to show up
    for (let row = 2; row <= 18; row++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: 1 });
      if (!worksheet[cellAddress]) {
        worksheet[cellAddress] = { t: 's', v: '' };
      }
    }
    
    // Update worksheet range to include all cells
    if (worksheet['!ref']) {
      const oldRange = XLSX.utils.decode_range(worksheet['!ref']);
      if (oldRange.e.c < 1) oldRange.e.c = 1; // Ensure column B is included
      worksheet['!ref'] = XLSX.utils.encode_range(oldRange);
    }

    // Set column widths
    // For film info section: wider label column and value column
    // For montage table: standard widths
    worksheet['!cols'] = [
      { wch: 30 }, // Film info labels / № плана
      { wch: 50 }, // Film info values / Начальный тайм-код
      { wch: 18 }, // Конечный тайм-код
      { wch: 12 }, // План
      { wch: 50 }, // Содержание
      { wch: 50 }, // Монологи
    ];

    // Включаем перенос текста в ячейках и добавляем стили
    // Update range after adding empty cells
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const filmInfoStartRow = 2; // Row 3 (0-indexed as 2)
    const filmInfoEndRow = 18; // Row 19 (0-indexed as 18) - last composer row
    const montageHeaderRow = 20; // Row 21 (0-indexed as 20)
    
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!worksheet[cellAddress]) continue;
        
        // Title row "Информация о фильме." - bold and centered
        if (row === 0 && col === 0) {
          worksheet[cellAddress].s = {
            font: { bold: true, size: 14 },
            alignment: { horizontal: 'center', vertical: 'center' },
          };
        }
        // Film info table labels (column A, rows 3-19) - bold
        else if (row >= filmInfoStartRow && row <= filmInfoEndRow && col === 0) {
          worksheet[cellAddress].s = {
            font: { bold: true },
            alignment: { vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: '000000' } },
              bottom: { style: 'thin', color: { rgb: '000000' } },
              left: { style: 'thin', color: { rgb: '000000' } },
              right: { style: 'thin', color: { rgb: '000000' } },
            },
          };
        }
        // Film info table values (column B, rows 3-19) - empty but with border
        else if (row >= filmInfoStartRow && row <= filmInfoEndRow && col === 1) {
          worksheet[cellAddress].s = {
            alignment: { vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: '000000' } },
              bottom: { style: 'thin', color: { rgb: '000000' } },
              left: { style: 'thin', color: { rgb: '000000' } },
              right: { style: 'thin', color: { rgb: '000000' } },
            },
          };
        }
        // Montage table header - bold
        else if (row === montageHeaderRow) {
          worksheet[cellAddress].s = {
            font: { bold: true },
            alignment: { wrapText: true, vertical: 'top', horizontal: 'center' },
          };
        }
        // All other cells - wrap text
        else {
          worksheet[cellAddress].s = {
            alignment: { wrapText: true, vertical: 'top' },
          };
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Montage');

    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });

    // Создаем безопасное имя файла (только латиница, цифры, дефисы)
    const safeFilename = `montage_${videoId.substring(0, 8)}.xlsx`;
    
    // Return as downloadable file
    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

