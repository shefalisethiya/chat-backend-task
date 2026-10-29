import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { pool } from "./db";
import { firestore, serverTimestamp } from "./firebase";
import { HttpError } from "./errors";

export interface ChatMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: string | null;
  readBy: string[];
}

async function assertMember(chatId: string, userId: string): Promise<void> {
  const result = await pool.query(
    "SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2",
    [chatId, userId]
  );
  if (result.rowCount === 0) throw new HttpError(403, "User is not a member of this chat");
}

export async function createOrGetDirectChat(userAId: string, userBId: string): Promise<string> {
  const userIds = [userAId, userBId].sort();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const users = await client.query(
      "SELECT id FROM users WHERE id = ANY($1::text[])",
      [userIds]
    );
    if (users.rowCount !== 2) throw new HttpError(404, "One or both users were not found");

    const existing = await client.query(
      "SELECT chat_id FROM direct_chat_pairs WHERE user_low = $1 AND user_high = $2",
      userIds
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      return String(existing.rows[0].chat_id);
    }

    const chat = await client.query(
      "INSERT INTO chats (is_group) VALUES (FALSE) RETURNING id"
    );
    const chatId = String(chat.rows[0].id);

    await client.query(
      "INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2), ($1, $3)",
      [chatId, userIds[0], userIds[1]]
    );
    await client.query(
      "INSERT INTO direct_chat_pairs (user_low, user_high, chat_id) VALUES ($1, $2, $3)",
      [userIds[0], userIds[1], chatId]
    );

    await client.query("COMMIT");
    return chatId;
  } catch (error) {
    await client.query("ROLLBACK");
    // In a race, another request may have created the same pair first.
    if (isUniqueViolation(error)) {
      const existing = await pool.query(
        "SELECT chat_id FROM direct_chat_pairs WHERE user_low = $1 AND user_high = $2",
        userIds
      );
      if (existing.rowCount) return String(existing.rows[0].chat_id);
    }
    throw error;
  } finally {
    client.release();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "23505";
}

export async function sendMessage(
  chatId: string,
  senderId: string,
  text: string
): Promise<ChatMessage> {
  const chat = await pool.query("SELECT id FROM chats WHERE id = $1", [chatId]);
  if (!chat.rowCount) throw new HttpError(404, "Chat not found");
  await assertMember(chatId, senderId);

  const messageId = randomUUID();
  const docRef = firestore.collection("chats").doc(chatId).collection("messages").doc(messageId);
  await docRef.set({
    messageId,
    chatId,
    senderId,
    text,
    createdAt: serverTimestamp(),
    readBy: [senderId],
  });

  await pool.query("UPDATE chats SET updated_at = NOW() WHERE id = $1", [chatId]);
  return { messageId, chatId, senderId, text, createdAt: new Date().toISOString(), readBy: [senderId] };
}

export async function getMessages(
  chatId: string,
  requesterId: string,
  limit: number
): Promise<ChatMessage[]> {
  const chat = await pool.query("SELECT id FROM chats WHERE id = $1", [chatId]);
  if (!chat.rowCount) throw new HttpError(404, "Chat not found");
  await assertMember(chatId, requesterId);

  const snapshot = await firestore.collection("chats").doc(chatId).collection("messages")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null;
    return {
      messageId: doc.id,
      chatId,
      senderId: String(data.senderId),
      text: String(data.text),
      createdAt,
      readBy: Array.isArray(data.readBy) ? data.readBy.map(String) : [],
    };
  }).reverse();
}

export async function markMessageRead(
  chatId: string,
  messageId: string,
  userId: string
): Promise<void> {
  await assertMember(chatId, userId);
  const ref = firestore.collection("chats").doc(chatId).collection("messages").doc(messageId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpError(404, "Message not found");
    transaction.update(ref, { readBy: FieldValue.arrayUnion(userId) });
  });
}

export async function updateLastSeen(
  chatId: string,
  userId: string,
  messageId: string
): Promise<void> {
  await assertMember(chatId, userId);
  const messageRef = firestore.collection("chats").doc(chatId).collection("messages").doc(messageId);
  const message = await messageRef.get();
  if (!message.exists) throw new HttpError(404, "Message not found");
  const lastSeenRef = firestore.collection("chats").doc(chatId).collection("lastSeen").doc(userId);
  await lastSeenRef.set({
    userId,
    messageId,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function listUserChats(userId: string): Promise<Array<{
  chatId: string; memberIds: string[]; isGroup: boolean; title: string | null; updatedAt: string;
}>> {
  const user = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
  if (!user.rowCount) throw new HttpError(404, "User not found");

  const result = await pool.query(
    `SELECT c.id AS chat_id, c.is_group, c.title, c.updated_at,
            ARRAY_AGG(cm2.user_id ORDER BY cm2.user_id) AS member_ids
     FROM chats c
     JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $1
     JOIN chat_members cm2 ON cm2.chat_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    [userId]
  );

  return result.rows.map((row) => ({
    chatId: String(row.chat_id),
    memberIds: (row.member_ids as string[]).map(String),
    isGroup: Boolean(row.is_group),
    title: row.title === null ? null : String(row.title),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}