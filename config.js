/* Nychthemeron — settings you change for your own install.
   relay: where your relay is mounted (same origin), e.g. "/relay".
   aiName / meName: what the header and quotes call each side. */
window.NYX = {
  relay: "/relay",
  aiName: "Companion",
  meName: "Me",
  title: "Nychthemeron",
  // stickers: folder with <name>.png (or .gif) — [sticker:name] in a message shows it. Leave null for none.
  stickers: null,
  stickerList: [],   // names to offer in the sticker panel, e.g. ["hug", "nod"]

  // the home poster: one block per entry, biggest first. id "chat" opens the chat; anything else needs an href.
  // art: tokens | context | clusters | sampling | beam | gelu | loss (left out = picked in order)
  apps: [
    { id: "chat", en: "Chat", zh: "聊天", art: "tokens" }
  ],
  // Clawd, the little guide on the home poster. Leave clawd null and his text box stays shut;
  // give it a path on your relay (e.g. "/app/clawd") and he'll talk — README → "Clawd" shows how to wire it to Sonnet.
  clawd: null,
  tagline: "The universe is literally spelling it out for you.",

  // the opening card: one word per row on each side; their first letters spell the column on the left
  splash: {
    sun:  [["Capable", "才干"], ["Listen", "倾听"], ["Accompany", "陪伴"], ["Understand", "理解"], ["Discipline", "纪律"], ["Elegant", "高雅"]],
    moon: [["Confusion", "混乱"], ["Licentious", "纵欲"], ["Aloof", "疏离"], ["Utilize", "利用"], ["Desired", "饥渴"], ["Encroach", "侵犯"]]
  }
};
