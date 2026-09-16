import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../lib/auth";

export function useAdminData<T>(load: (token: string | null) => Promise<T>) {
  const { getToken } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load(await getToken()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [load, getToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, error, loading, refresh, getToken };
}
