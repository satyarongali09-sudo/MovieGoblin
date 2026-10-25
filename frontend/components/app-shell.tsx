"use client";

import Link from "next/link";
import Image from "next/image";
import { LogoutButton } from "@/components/logout-button";
import { getAuthenticatedUser, getGoogleAvatarUrl, type AuthenticatedUser, type UserRole } from "@/lib/supabase/profile";
import { useAuth } from "@/components/auth-provider";

type AppShellProps = {
  children: React.ReactNode;
  user?: AuthenticatedUser;
  role?: UserRole;
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function AppShell({ children, user, role }: AppShellProps) {
  const { user: sessionUser, role: sessionRole } = useAuth();
  const activeUser = user ?? (sessionUser ? getAuthenticatedUser(sessionUser) : undefined);
  const activeRole = role ?? sessionRole;
  const avatarUrl = getGoogleAvatarUrl(activeUser?.avatarUrl);
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          WordGoblin
        </Link>
        <nav className="nav" aria-label="Primary">
          <Link href="/">Today's puzzle</Link>
          {activeUser ? <Link href="/profile">Profile</Link> : null}
        </nav>
        {activeUser ? (
          <div className="account-menu">
            <span className="avatar" aria-hidden="true">
              {avatarUrl ? (
                <Image src={avatarUrl} alt="" width={32} height={32} />
              ) : (
                getInitials(activeUser.name)
              )}
            </span>
            <div className="account-copy">
              <span>{activeUser.name}</span>
              {activeUser.email ? <small>{activeUser.email}</small> : null}
            </div>
            <LogoutButton />
          </div>
        ) : (
          <Link href="/login">Login</Link>
        )}
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
