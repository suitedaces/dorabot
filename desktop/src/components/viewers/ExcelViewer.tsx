import { useEffect, useState } from 'react';
import { readXlsx } from '@/lib/xlsx';

type Props = {
  filePath: string;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

type SheetData = {
  name: string;
  data: (string | number)[][];
};

function parseCsv(text: string): (string | number)[][] {
  const rows: (string | number)[][] = [];
  let i = 0;
  while (i < text.length) {
    const row: (string | number)[] = [];
    while (i < text.length) {
      let value = '';
      if (text[i] === '"') {
        // Quoted field
        i++;
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { value += '"'; i += 2; }
            else { i++; break; }
          } else { value += text[i]; i++; }
        }
        if (text[i] === ',') i++;
        else if (text[i] === '\r') i++;
      } else {
        // Unquoted field
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          value += text[i]; i++;
        }
        if (text[i] === ',') i++;
      }
      const trimmed = value.trim();
      const num = Number(trimmed);
      row.push(trimmed !== '' && !isNaN(num) ? num : value);
    }
    if (text[i] === '\n') i++;
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

export function ExcelViewer({ filePath, rpc }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);

  const ext = filePath.split('.').pop()?.toLowerCase();

  useEffect(() => {
    setLoading(true);
    setError(null);

    if (ext === 'csv') {
      rpc('fs.read', { path: filePath })
        .then((res) => {
          const result = res as { content: string };
          const data = parseCsv(result.content);
          setSheets([{ name: 'Sheet1', data }]);
          setActiveSheet(0);
          setLoading(false);
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
      return;
    }

    if (ext === 'xls') {
      setError('Legacy .xls format is not supported. Save as .xlsx and try again.');
      setLoading(false);
      return;
    }

    rpc('fs.readBinary', { path: filePath })
      .then(async (res) => {
        const result = res as { content: string };
        const base64 = result.content;

        // Convert base64 to ArrayBuffer
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const sheetData: SheetData[] = await readXlsx(bytes);

        setSheets(sheetData);
        setActiveSheet(0);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [filePath, rpc, ext]);

  if (loading) {
    return <div className="excel-viewer-loading">loading excel file...</div>;
  }

  if (error) {
    return (
      <div className="excel-viewer-error">
        <p>failed to load excel file</p>
        <p style={{ fontSize: '12px', marginTop: '8px', opacity: 0.7 }}>{error}</p>
      </div>
    );
  }

  if (sheets.length === 0) {
    return <div className="excel-viewer-error">no sheets found in file</div>;
  }

  const currentSheet = sheets[activeSheet];

  return (
    <div className="excel-viewer-container">
      {sheets.length > 1 && (
        <div className="excel-sheet-tabs">
          {sheets.map((sheet, i) => (
            <button
              key={i}
              className={`excel-sheet-tab ${i === activeSheet ? 'active' : ''}`}
              onClick={() => setActiveSheet(i)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <div className="excel-table-wrapper">
        <table className="excel-table">
          <tbody>
            {currentSheet.data.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
