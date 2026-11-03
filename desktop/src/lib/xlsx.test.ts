import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { columnIndex, parseSheetXml, readXlsx } from './xlsx';

const sample = new Uint8Array(readFileSync(path.join(__dirname, '__fixtures__', 'sample.xlsx')));

describe('xlsx reader', () => {
  it('maps column letters to indexes', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA10')).toBe(26);
    expect(columnIndex('AZ1')).toBe(51);
  });

  it('reads every sheet with shared strings, numbers, booleans, rich text and gaps', async () => {
    const sheets = await readXlsx(sample);
    expect(sheets.map(s => s.name)).toEqual(['Orders', 'Empty', 'Second']);
    expect(sheets[0].data).toEqual([
      ['id', 'name', 'qty', 'ok', 'note'],
      [1, 'apple', 3.5, 'TRUE', 'rich bold'],
      [2, 'banana', '', 'FALSE', 'x'],
      [3, 'cherry & co <tag>', 10, 'TRUE', 'last'],
    ]);
    expect(sheets[1].data).toEqual([]);
    expect(sheets[2].data).toEqual([['a1'], ['', '', 'far']]);
  });

  it('handles inline strings and namespaced sheet xml', () => {
    const xml = `<?xml version="1.0"?>
      <x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
        <x:row r="1"><x:c r="B1" t="inlineStr"><x:is><x:t>hi</x:t></x:is></x:c><x:c r="C1"><x:v>2</x:v></x:c></x:row>
        <x:row r="2"><x:c r="A2" t="s"><x:v>0</x:v></x:c><x:c r="B2" t="e"><x:v>#DIV/0!</x:v></x:c></x:row>
      </x:sheetData></x:worksheet>`;
    expect(parseSheetXml(xml, ['shared'])).toEqual([['', 'hi', 2], ['shared', '#DIV/0!']]);
  });

  it('rejects files that are not zips', async () => {
    await expect(readXlsx(new TextEncoder().encode('not a workbook'))).rejects.toThrow('not a zip file');
  });
});
