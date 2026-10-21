import { attachmentsLabel } from "@/features/chat/attachments";
import { plainText } from "@/features/chat/markup";
import type { Shown } from "@/features/chat/use-chat-crypto";

// One line about a message for the chats list, notifications, quotes:
// its text without formatting, or what files it has.
export function messagePreview(shown: Shown) {
  return plainText(shown.text).trim() || attachmentsLabel(shown.attachments);
}
