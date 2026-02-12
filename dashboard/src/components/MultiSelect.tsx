import { useState, useRef, useEffect, useCallback } from 'react';

interface MultiSelectProps {
  /** Currently selected values (empty array = "All"). */
  value: string[];
  /** Available options. */
  options: string[];
  /** Callback when selection changes. */
  onChange: (selected: string[]) => void;
  /** Placeholder text when nothing is selected. */
  placeholder?: string;
  /** Maximum height of the dropdown list (px). */
  maxHeight?: number;
}

/**
 * Multi-select dropdown with checkboxes.
 * Compact display showing selected count or tag chips.
 * Supports keyboard navigation and click-outside-to-close.
 */
export function MultiSelect({
  value,
  options,
  onChange,
  placeholder = 'All',
  maxHeight = 260,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  const toggle = useCallback(
    (opt: string) => {
      if (value.includes(opt)) {
        onChange(value.filter((v) => v !== opt));
      } else {
        onChange([...value, opt]);
      }
    },
    [value, onChange],
  );

  const clearAll = useCallback(() => {
    onChange([]);
    setSearch('');
  }, [onChange]);

  const selectAll = useCallback(() => {
    onChange([...options]);
    setSearch('');
  }, [options, onChange]);

  // Filter options by search term
  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  // Display text for the trigger button
  let displayText: string;
  if (value.length === 0) {
    displayText = placeholder;
  } else if (value.length === 1) {
    displayText = value[0];
  } else if (value.length <= 2) {
    displayText = value.join(', ');
  } else {
    displayText = `${value.length} selected`;
  }

  return (
    <div className="ms-container" ref={containerRef}>
      <button
        type="button"
        className={`ms-trigger${value.length > 0 ? ' ms-active' : ''}`}
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value.length > 0 ? value.join(', ') : placeholder}
      >
        <span className="ms-trigger-text">{displayText}</span>
        <span className="ms-trigger-arrow">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div className="ms-dropdown" role="listbox" aria-multiselectable>
          {/* Search input (shown when more than 6 options) */}
          {options.length > 6 && (
            <div className="ms-search-wrap">
              <input
                ref={searchRef}
                type="text"
                className="ms-search"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* Select all / Clear all */}
          <div className="ms-actions">
            <button type="button" className="ms-action-btn" onClick={selectAll}>
              Select all
            </button>
            <button type="button" className="ms-action-btn" onClick={clearAll}>
              Clear
            </button>
          </div>

          {/* Options list */}
          <div className="ms-options" style={{ maxHeight }}>
            {filtered.length === 0 && (
              <div className="ms-no-results">No matches</div>
            )}
            {filtered.map((opt) => {
              const checked = value.includes(opt);
              return (
                <label
                  key={opt}
                  className={`ms-option${checked ? ' ms-option-checked' : ''}`}
                  role="option"
                  aria-selected={checked}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    tabIndex={-1}
                  />
                  <span className="ms-option-label">{opt}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
