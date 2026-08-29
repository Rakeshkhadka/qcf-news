"use client";

/**
 * User pickers for the admin UI.
 *
 * Administrators know their colleagues by name or email, never by the numeric
 * primary key, so every place that used to ask for a "User ID" now searches the
 * user directory instead.  Both widgets here share one debounced search against
 * `GET /users/`.
 *
 *   • <UserPicker>      — single-select combobox (who am I looking at?)
 *   • <UserMultiSelect> — checkbox list for bulk actions (who do I assign?)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { User, userLabel, users } from "../../../lib/admin-api";

const PAGE_SIZE = 25;

// ── Shared search hook ────────────────────────────────────────────────────────

/**
 * Debounced directory search.  A stale response can only arrive after a newer
 * one when the network reorders them, so results are tagged with the request
 * sequence and late answers are dropped.
 */
function useUserSearch(term: string, enabled: boolean) {
  const [results, setResults] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const mySeq = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await users.list({
          search: term.trim() || undefined,
          page_size: PAGE_SIZE,
        });
        if (seq.current !== mySeq) return;
        setResults(res.data);
        setTotal(res.total_count);
        setError("");
      } catch (e: any) {
        if (seq.current !== mySeq) return;
        setResults([]);
        setTotal(0);
        setError(e.message ?? "Could not load users");
      } finally {
        if (seq.current === mySeq) setLoading(false);
      }
    }, term ? 250 : 0);

    return () => clearTimeout(timer);
  }, [term, enabled]);

  return { results, total, loading, error };
}

// ── Avatar ────────────────────────────────────────────────────────────────────

export function UserAvatar({ user, size = 32 }: { user: User; size?: number }) {
  const initials = useMemo(() => {
    const first = user.first_name?.[0];
    const last = user.last_name?.[0];
    if (first || last) return `${first ?? ""}${last ?? ""}`.toUpperCase();
    return user.email.slice(0, 2).toUpperCase();
  }, [user]);

  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        background: "linear-gradient(135deg, var(--accent), var(--accent2))",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 700,
        letterSpacing: "0.02em",
      }}
    >
      {initials}
    </div>
  );
}

/** Name over email, the two-line identity block used in every list row. */
function UserIdentity({ user, size = 32 }: { user: User; size?: number }) {
  const label = userLabel(user);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <UserAvatar user={user} size={size} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "0.875rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
          {user.is_superuser && (
            <span className="badge badge-blue" style={{ marginLeft: 8 }}>Super</span>
          )}
        </div>
        {label !== user.email && (
          <div
            style={{
              fontSize: "0.78rem",
              color: "var(--text2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.email}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Single-select combobox ────────────────────────────────────────────────────

export function UserPicker({
  value,
  onChange,
  placeholder = "Search by name or email…",
  autoFocus = false,
}: {
  value: User | null;
  onChange: (user: User | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const { results, total, loading, error } = useUserSearch(term, open);

  // Close on outside click so the dropdown never strands over other controls.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => setHighlight(0), [results]);

  const select = useCallback(
    (user: User) => {
      onChange(user);
      setOpen(false);
      setTerm("");
    },
    [onChange]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlight]) select(results[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Selected state: show the chosen person, with a clear button to search again.
  if (value && !open) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "8px 12px",
          background: "var(--bg3)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <UserIdentity user={value} />
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
            Change
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        autoFocus={autoFocus || open}
        value={term}
        placeholder={placeholder}
        onChange={e => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 60,
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "var(--shadow)",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {error ? (
            <div style={{ padding: 14, fontSize: "0.82rem", color: "var(--red)" }}>{error}</div>
          ) : loading && results.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center" }}>
              <div className="loader-ring" style={{ margin: "0 auto", width: 26, height: 26 }} />
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: 14, fontSize: "0.82rem", color: "var(--text2)" }}>
              No users match “{term}”
            </div>
          ) : (
            <>
              {results.map((u, i) => (
                <button
                  key={u.id}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => select(u)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 12px",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    background: i === highlight ? "rgba(99,102,241,0.12)" : "transparent",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <UserIdentity user={u} size={28} />
                </button>
              ))}
              {total > results.length && (
                <div style={{ padding: "8px 12px", fontSize: "0.75rem", color: "var(--text2)" }}>
                  Showing {results.length} of {total} — keep typing to narrow it down
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Multi-select list ─────────────────────────────────────────────────────────

export function UserMultiSelect({
  selected,
  onChange,
  /** Users already in the target set — shown ticked and locked. */
  lockedIds = [],
  lockedNote = "Already assigned",
}: {
  selected: User[];
  onChange: (users: User[]) => void;
  lockedIds?: number[];
  lockedNote?: string;
}) {
  const [term, setTerm] = useState("");
  const { results, total, loading, error } = useUserSearch(term, true);

  const selectedIds = useMemo(() => new Set(selected.map(u => u.id)), [selected]);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);

  const toggle = (user: User) => {
    if (locked.has(user.id)) return;
    onChange(
      selectedIds.has(user.id)
        ? selected.filter(u => u.id !== user.id)
        : [...selected, user]
    );
  };

  return (
    <div>
      <input
        autoFocus
        value={term}
        placeholder="Search by name or email…"
        onChange={e => setTerm(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      {error && <div className="error-box">{error}</div>}

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg3)",
          maxHeight: 280,
          overflowY: "auto",
        }}
      >
        {loading && results.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <div className="loader-ring" style={{ margin: "0 auto", width: 26, height: 26 }} />
          </div>
        ) : results.length === 0 ? (
          <div style={{ padding: 16, fontSize: "0.82rem", color: "var(--text2)" }}>
            No users match “{term}”
          </div>
        ) : (
          results.map(u => {
            const isLocked = locked.has(u.id);
            const checked = isLocked || selectedIds.has(u.id);
            return (
              <label
                key={u.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderBottom: "1px solid var(--border)",
                  cursor: isLocked ? "not-allowed" : "pointer",
                  opacity: isLocked ? 0.55 : 1,
                  textTransform: "none",
                  letterSpacing: 0,
                  margin: 0,
                  color: "var(--text)",
                  fontSize: "0.875rem",
                  fontWeight: 400,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isLocked}
                  onChange={() => toggle(u)}
                  style={{ width: "auto", flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <UserIdentity user={u} size={28} />
                </div>
                {isLocked && (
                  <span style={{ fontSize: "0.72rem", color: "var(--text2)", flexShrink: 0 }}>
                    {lockedNote}
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          marginTop: 8,
          fontSize: "0.75rem",
          color: "var(--text2)",
        }}
      >
        <span>
          {selected.length > 0
            ? `${selected.length} selected`
            : "Tick the people you want to add"}
        </span>
        {total > results.length && <span>Showing {results.length} of {total}</span>}
      </div>

      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {selected.map(u => (
            <button
              key={u.id}
              onClick={() => toggle(u)}
              title="Remove from selection"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 99,
                border: "1px solid rgba(99,102,241,0.3)",
                background: "rgba(99,102,241,0.15)",
                color: "var(--accent)",
                fontSize: "0.75rem",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {userLabel(u)} ✕
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
