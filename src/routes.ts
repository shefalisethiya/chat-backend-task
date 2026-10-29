import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { HttpError } from "./errors";
import {
  createOrGetDirectChat, getMessages, listUserChats, markMessageRead,
  sendMessage, updateLastSeen
} from "./chatService";
import { createChatSchema, lastSeenSchema, sendMessageSchema, userIdSchema } from "./validation";

export const router = Router();

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map(i => i.message).join("; "));
  return parsed.data;
}

function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

router.post("/chat/create", asyncHandler(async (req, res) => {
  const body = parseBody(createChatSchema, req.body);
  const chatId = await createOrGetDirectChat(body.userAId, body.userBId);
  res.status(200).json({ chatId });
}));

router.post("/chat/:chatId/message/send", asyncHandler(async (req, res) => {
  const body = parseBody(sendMessageSchema, req.body);
  const message = await sendMessage(String(req.params.chatId), body.senderId, body.text);
  res.status(201).json({ message });
}));

router.get("/chat/:chatId/messages", asyncHandler(async (req, res) => {
  const userId = String(req.query.userId ?? "");
  if (!userId.trim()) throw new HttpError(400, "Query parameter userId is required");
  const rawLimit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    throw new HttpError(400, "limit must be an integer between 1 and 100");
  }
  const messages = await getMessages(String(req.params.chatId), userId, rawLimit);
  res.json({ messages });
}));

router.post("/chat/:chatId/message/:messageId/read", asyncHandler(async (req, res) => {
  const body = parseBody(userIdSchema, req.body);
 await markMessageRead(String(req.params.chatId), String(req.params.messageId), body.userId);
  res.json({ success: true });
}));

router.post("/chat/:chatId/lastseen", asyncHandler(async (req, res) => {
  const body = parseBody(lastSeenSchema, req.body);
  await updateLastSeen(String(req.params.chatId), body.userId, body.messageId);
  res.json({ success: true });
}));

router.get("/user/:userId/chats", asyncHandler(async (req, res) => {
 const chats = await listUserChats(String(req.params.userId));
  res.json({ chats });
}));