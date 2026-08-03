import { useState } from "react";
import { useQAStore } from "@/hooks/use-qa-store";
import { Avatar, UserProfileDialog } from "./user-profile-dialog";

/**
 * Top-bar entry: a small avatar circle. Click → opens the user profile
 * dialog. When no name has been set, shows a "?" placeholder with a subtle
 * dashed ring to invite the user to fill it in.
 */
export function UserButton() {
  const { user } = useQAStore();
  const [open, setOpen] = useState(false);

  const empty = !user.name;
  const label = user.name
    ? `${user.name}${user.role ? ` · ${user.role}` : ""}`
    : "点击设置个人信息";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={
          "inline-flex items-center justify-center rounded-full transition-shadow hover:ring-2 hover:ring-ring/40 focus:outline-none focus:ring-2 focus:ring-ring " +
          (empty ? "ring-1 ring-dashed ring-border" : "")
        }
      >
        <Avatar user={user} size={28} />
      </button>
      <UserProfileDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
