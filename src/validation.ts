import { z } from "zod";

export const createChatSchema = z.object({
  userAId: z.string().trim().min(1).max(128),
  userBId: z.string().trim().min(1).max(128),
}).refine((data) => data.userAId !== data.userBId, {
  message: "A direct chat requires two different users",
});

export const sendMessageSchema = z.object({
  senderId: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(5000),
});

export const userIdSchema = z.object({
  userId: z.string().trim().min(1).max(128),
});

export const lastSeenSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  messageId: z.string().trim().min(1).max(256),
});