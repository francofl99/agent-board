import { useEffect, useState } from "react";

const PREFIX = "agent-board:";

// Filters and density are UI preferences, not session data: they belong in the
// browser, not in ~/.agent-board.
export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* private window or blocked storage: the app still works, it just forgets */
    }
  }, [key, value]);

  return [value, setValue];
}
