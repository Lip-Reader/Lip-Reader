import { ClerkProvider, useAuth, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { createContext, ReactNode, useContext, useMemo } from "react";

const KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const FORCE_ADMIN = __DEV__ && process.env.EXPO_PUBLIC_FORCE_ADMIN === "1";

export type Session = {
  enabled: boolean;
  loaded: boolean;
  signedIn: boolean;
  isAdmin: boolean;
  email: string | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const disabled: Session = {
  enabled: false,
  loaded: true,
  signedIn: false,
  isAdmin: false,
  email: null,
  getToken: async () => null,
  signOut: async () => {},
};

const forced: Session = { ...disabled, enabled: true, signedIn: true, isAdmin: true, email: "dev@local", getToken: async () => "dev" };

const Ctx = createContext<Session>(disabled);

export function AuthProvider({ children }: { children: ReactNode }) {
  if (FORCE_ADMIN) return <Ctx.Provider value={forced}>{children}</Ctx.Provider>;
  if (!KEY) return <Ctx.Provider value={disabled}>{children}</Ctx.Provider>;
  return (
    <ClerkProvider publishableKey={KEY} tokenCache={tokenCache}>
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  );
}

function Bridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const value = useMemo<Session>(
    () => ({
      enabled: true,
      loaded: isLoaded,
      signedIn: !!isSignedIn,
      isAdmin: user?.publicMetadata?.role === "admin",
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      getToken: () => getToken(),
      signOut: () => signOut(),
    }),
    [isLoaded, isSignedIn, user, getToken, signOut]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
