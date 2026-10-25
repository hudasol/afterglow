import { useCallback, useState } from 'react';
import type { CaseView } from '../../../src/domain/case-view.js';
import { ApiError } from '../lib/api';

export function useCaseActions(onView: (view: CaseView) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, action: () => Promise<CaseView>): Promise<boolean> => {
      setBusy(label);
      setError(null);
      try {
        onView(await action());
        return true;
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onView],
  );

  return { busy, error, run, clearError: () => setError(null) };
}
