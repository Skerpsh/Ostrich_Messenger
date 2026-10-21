import { attachmentsLabel } from "@/features/chat/attachments";
import { plainText } from "@/features/chat/markup";
import type { Shown } from "@/features/chat/use-chat-crypto";

// One line about a message for the chats list, notifications, quotes:
// its text without formatting, or what files it has.
export function messagePreview(shown: Shown) {
  // A sealed letter not opened here: not its long text for other clients.
  if (shown.sealed && !shown.sealed.opened) {
    return shown.sealed.surprise ? "🎁 Surprise letter" : "🔒 Sealed letter";
  }

  return plainText(shown.text).trim() || attachmentsLabel(shown.attachments);
}
