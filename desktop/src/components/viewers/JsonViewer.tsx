import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Copy,
  FileJson,
  Pencil,
  Search,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { getPalette } from '@/lib/palettes';
import {
  formatJsonPath,
  jsonPathKey,
  parseJson,
  serializeJsonValue,
  type JsonPathSegment,
  type JsonValue,
} from '@/lib/json-viewer';
import { cn } from '@/lib/utils';

type Props = {
  content: string;
  onEdit: () => void;
};

type SearchResult = {
  visible: Set<string>;
  matched: Set<string>;
  expanded: Set<string>;
  count: number;
  capped: boolean;
};

const PAGE_SIZE = 200;
const SEARCH_LIMIT = 300;
const SEARCH_SCAN_LIMIT = 50_000;

function isContainer(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object';
}

function entries(value: JsonValue): [JsonPathSegment, JsonValue][] {
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  if (isContainer(value)) return Object.entries(value);
  return [];
}

function primitiveText(value: JsonValue): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function pathSegmentLabel(segment: JsonPathSegment): string {
  if (typeof segment === 'number') return `[${segment}]`;
  if (/^[A-Za-z_$][\w$]*$/.test(segment)) return `.${segment}`;
  return `[${JSON.stringify(segment)}]`;
}

function collectExpanded(value: JsonValue, maxDepth: number): Set<string> {
  const result = new Set<string>();

  const visit = (current: JsonValue, path: JsonPathSegment[], depth: number) => {
    if (!isContainer(current) || depth >= maxDepth) return;
    result.add(jsonPathKey(path));
    for (const [segment, child] of entries(current).slice(0, PAGE_SIZE)) {
      visit(child, [...path, segment], depth + 1);
    }
  };

  visit(value, [], 0);
  return result;
}

function searchJson(value: JsonValue, rawQuery: string): SearchResult | null {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return null;

  const visible = new Set<string>();
  const matched = new Set<string>();
  const expanded = new Set<string>();
  let count = 0;
  let capped = false;
  let visited = 0;

  const visit = (current: JsonValue, path: JsonPathSegment[], label?: JsonPathSegment): boolean => {
    if (count >= SEARCH_LIMIT || visited >= SEARCH_SCAN_LIMIT) {
      capped = true;
      return false;
    }
    visited += 1;

    const key = jsonPathKey(path);
    const labelMatch = label !== undefined && String(label).toLowerCase().includes(query);
    const valueMatch = !isContainer(current) && primitiveText(current).toLowerCase().includes(query);
    const ownMatch = labelMatch || valueMatch;
    if (ownMatch) {
      matched.add(key);
      count += 1;
    }

    let childMatch = false;
    if (isContainer(current)) {
      for (const [segment, child] of entries(current)) {
        if (visit(child, [...path, segment], segment)) childMatch = true;
        if (count >= SEARCH_LIMIT) {
          capped = true;
          break;
        }
      }
    }

    if (ownMatch || childMatch) visible.add(key);
    if (childMatch) expanded.add(key);
    return ownMatch || childMatch;
  };

  visit(value, []);
  return { visible, matched, expanded, count, capped };
}

export function JsonViewer({ content, onEdit }: Props) {
  const parsed = useMemo(() => parseJson(content), [content]);
  const { palette } = useTheme();
  const colors = getPalette(palette).terminal;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([jsonPathKey([])]));
  const [pageSizes, setPageSizes] = useState<Record<string, number>>({});
  const [selectedPath, setSelectedPath] = useState<JsonPathSegment[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const searchResult = useMemo(
    () => parsed.ok ? searchJson(parsed.value, query) : null,
    [parsed, query],
  );

  useEffect(() => {
    setQuery('');
    setExpanded(new Set([jsonPathKey([])]));
    setPageSizes({});
    setSelectedPath([]);
  }, [content]);

  const copyText = useCallback(async (text: string, token: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(token);
      window.setTimeout(() => setCopied(current => current === token ? null : current), 1200);
    } catch {}
  }, []);

  const revealPath = useCallback((path: JsonPathSegment[]) => {
    setExpanded(current => {
      const next = new Set(current);
      for (let i = 0; i < path.length; i += 1) next.add(jsonPathKey(path.slice(0, i)));
      return next;
    });
    setSelectedPath(path);
    requestAnimationFrame(() => rowRefs.current.get(jsonPathKey(path))?.scrollIntoView({ block: 'nearest' }));
  }, []);

  if (!parsed.ok) {
    const location = parsed.line && parsed.column ? `Line ${parsed.line}, column ${parsed.column}` : null;
    return (
      <div className="h-full flex items-start justify-center p-8 bg-background">
        <div className="w-full max-w-xl rounded-lg border border-destructive/25 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">This JSON is not valid</div>
              {location && <div className="mt-1 text-xs text-destructive">{location}</div>}
              <div className="mt-2 font-mono text-[11px] leading-5 text-muted-foreground break-words">
                {parsed.message}
              </div>
              <button
                type="button"
                onClick={onEdit}
                className="mt-4 inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-secondary"
              >
                <Pencil className="w-3 h-3" />
                Edit JSON
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const rootValue = parsed.value;
  const effectiveExpanded = new Set(expanded);
  searchResult?.expanded.forEach(key => effectiveExpanded.add(key));
  const selectedKey = jsonPathKey(selectedPath);

  const toggleExpanded = (key: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const valueColor = (value: JsonValue): string => {
    if (value === null) return colors.brightBlack;
    if (typeof value === 'string') return colors.green;
    if (typeof value === 'number') return colors.yellow;
    if (typeof value === 'boolean') return colors.magenta;
    return colors.foreground;
  };

  const renderNode = (
    value: JsonValue,
    path: JsonPathSegment[],
    label: JsonPathSegment | 'root',
    depth: number,
  ): React.ReactNode => {
    const key = jsonPathKey(path);
    if (searchResult && !searchResult.visible.has(key)) return null;

    const container = isContainer(value);
    const open = container && effectiveExpanded.has(key);
    const childEntries = container ? entries(value) : [];
    const visibleChildren = searchResult
      ? childEntries.filter(([segment]) => searchResult.visible.has(jsonPathKey([...path, segment])))
      : childEntries;
    const limit = searchResult ? visibleChildren.length : (pageSizes[key] ?? PAGE_SIZE);
    const shownChildren = visibleChildren.slice(0, limit);
    const countLabel = Array.isArray(value)
      ? `${childEntries.length} ${childEntries.length === 1 ? 'item' : 'items'}`
      : container
        ? `${childEntries.length} ${childEntries.length === 1 ? 'key' : 'keys'}`
        : null;
    const pathText = formatJsonPath(path);
    const valueToken = `value:${key}`;
    const pathToken = `path:${key}`;

    return (
      <div key={key}>
        <div
          ref={node => {
            if (node) rowRefs.current.set(key, node);
            else rowRefs.current.delete(key);
          }}
          role="treeitem"
          aria-expanded={container ? open : undefined}
          aria-selected={selectedKey === key}
          tabIndex={selectedKey === key ? 0 : -1}
          className={cn(
            'group flex h-7 min-w-0 items-center border-l-2 border-transparent pr-2 font-mono text-[12px] outline-none transition-colors',
            'hover:bg-secondary/50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
            selectedKey === key && 'border-l-primary bg-secondary/70',
            searchResult?.matched.has(key) && 'bg-primary/10',
          )}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => setSelectedPath(path)}
          onDoubleClick={() => container && toggleExpanded(key)}
          onKeyDown={event => {
            if (!container) return;
            if (event.key === 'ArrowRight' && !open) toggleExpanded(key);
            if (event.key === 'ArrowLeft' && open) toggleExpanded(key);
          }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? `Collapse ${pathText}` : `Expand ${pathText}`}
            className={cn('mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-background/70', !container && 'invisible')}
            onClick={event => {
              event.stopPropagation();
              toggleExpanded(key);
            }}
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          <span className="shrink-0" style={{ color: label === 'root' ? colors.blue : colors.foreground }}>
            {label === 'root' ? 'root' : typeof label === 'number' ? `[${label}]` : JSON.stringify(label)}
          </span>
          {label !== 'root' && <span className="mr-2 text-muted-foreground">:</span>}

          {container ? (
            <>
              <span style={{ color: colors.cyan }}>{Array.isArray(value) ? '[ ]' : '{ }'}</span>
              <span className="ml-2 text-[10px] text-muted-foreground">{countLabel}</span>
            </>
          ) : (
            <span className="min-w-0 truncate" style={{ color: valueColor(value) }} title={primitiveText(value)}>
              {primitiveText(value)}
            </span>
          )}

          <span className="flex-1" />
          <div className="ml-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              title="Copy value"
              aria-label={`Copy value at ${pathText}`}
              onClick={event => {
                event.stopPropagation();
                void copyText(serializeJsonValue(value), valueToken);
              }}
            >
              {copied === valueToken ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
            <button
              type="button"
              className="flex h-5 px-1.5 items-center justify-center rounded text-[9px] text-muted-foreground hover:bg-background hover:text-foreground"
              title="Copy JSONPath"
              aria-label={`Copy JSONPath ${pathText}`}
              onClick={event => {
                event.stopPropagation();
                void copyText(pathText, pathToken);
              }}
            >
              {copied === pathToken ? <Check className="w-3 h-3" /> : '$'}
            </button>
          </div>
        </div>

        {open && (
          <div role="group">
            {shownChildren.map(([segment, child]) => renderNode(child, [...path, segment], segment, depth + 1))}
            {shownChildren.length < visibleChildren.length && (
              <button
                type="button"
                className="h-7 text-[11px] text-primary hover:underline"
                style={{ marginLeft: `${32 + depth * 16}px` }}
                onClick={() => setPageSizes(current => ({ ...current, [key]: limit + PAGE_SIZE }))}
              >
                Show {Math.min(PAGE_SIZE, visibleChildren.length - shownChildren.length)} more
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      onKeyDownCapture={event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          searchInputRef.current?.focus();
        }
      }}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 px-2">
        <div className="relative min-w-[160px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search keys and values"
            aria-label="Search JSON"
            className="h-7 w-full rounded-md border border-border bg-transparent pl-7 pr-2 text-[11px] outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/40"
          />
        </div>
        {searchResult && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {searchResult.count} {searchResult.count === 1 ? 'match' : 'matches'}{searchResult.capped ? ' · partial' : ''}
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded(new Set())}
          className="inline-flex h-7 items-center gap-1 rounded px-2 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Collapse all"
        >
          <ChevronsUp className="w-3.5 h-3.5" />
          Collapse
        </button>
        <button
          type="button"
          onClick={() => setExpanded(collectExpanded(rootValue, 2))}
          className="inline-flex h-7 items-center gap-1 rounded px-2 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Expand two levels"
        >
          <ChevronsDown className="w-3.5 h-3.5" />
          Expand 2
        </button>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-muted/20 px-2 font-mono text-[10px]">
        <FileJson className="mr-1 h-3.5 w-3.5 shrink-0" style={{ color: colors.cyan }} />
        <button type="button" onClick={() => revealPath([])} className="rounded px-1 py-0.5 hover:bg-secondary">$</button>
        {selectedPath.map((segment, index) => (
          <button
            type="button"
            key={`${index}:${String(segment)}`}
            onClick={() => revealPath(selectedPath.slice(0, index + 1))}
            className="whitespace-nowrap rounded px-0.5 py-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {pathSegmentLabel(segment)}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          className="ml-2 flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={() => void copyText(formatJsonPath(selectedPath), `selected:${selectedKey}`)}
        >
          {copied === `selected:${selectedKey}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          JSONPath
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label="JSON document">
        {searchResult && searchResult.count === 0
          ? <div className="px-4 py-10 text-center text-xs text-muted-foreground">No matching keys or values</div>
          : renderNode(rootValue, [], 'root', 0)}
      </div>
    </div>
  );
}
