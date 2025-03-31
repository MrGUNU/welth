"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { GoogleGenerativeAI } from "@google/generative-ai";
import aj from "@/lib/arcjet";
import { request } from "@arcjet/next";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const serializeAmount = (obj) => ({
  ...obj,
  amount: obj.amount.toNumber(),
});

// Create Transaction
export async function createTransaction(data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    // Get request data for ArcJet
    const req = await request();

    // Check rate limit
    const decision = await aj.protect(req, {
      userId,
      requested: 1,
    });

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        const { remaining, reset } = decision.reason;
        console.error({
          code: "RATE_LIMIT_EXCEEDED",
          details: { remaining, resetInSeconds: reset },
        });
        throw new Error("Too many requests. Please try again later.");
      }
      throw new Error("Request blocked");
    }

    // First verify user exists
    const user = await db.user.findFirst({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    // Verify account exists and belongs to user
    const account = await db.account.findFirst({
      where: {
        id: data.accountId,
        userId: user.id,
      },
    });
    if (!account) throw new Error("Account not found");

    // Calculate new balance
    const balanceChange = data.type === "EXPENSE" ? -data.amount : data.amount;
    const newBalance = account.balance.toNumber() + balanceChange;

    // Create transaction and update account balance in a transaction
    const [transaction] = await db.$transaction([
      db.transaction.create({
        data: {
          ...data,
          userId: user.id,
          nextRecurringDate: data.isRecurring && data.recurringInterval
            ? calculateNextRecurringDate(data.date, data.recurringInterval)
            : null,
        },
      }),
      db.account.update({
        where: { id: data.accountId },
        data: { balance: newBalance },
      }),
    ]);

    revalidatePath("/dashboard");
    revalidatePath(`/account/${data.accountId}`);

    return { 
      success: true, 
      data: serializeAmount(transaction) 
    };
  } catch (error) {
    console.error("Error creating transaction:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

export async function getTransaction(id) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findFirst({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const transaction = await db.transaction.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });
    if (!transaction) throw new Error("Transaction not found");

    return serializeAmount(transaction);
  } catch (error) {
    console.error("Error getting transaction:", error);
    throw error;
  }
}

export async function updateTransaction(id, data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findFirst({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    // Get original transaction with account info
    const originalTransaction = await db.transaction.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        account: true,
      },
    });
    if (!originalTransaction) throw new Error("Transaction not found");

    // Calculate balance changes
    const oldBalanceChange = originalTransaction.type === "EXPENSE"
      ? -originalTransaction.amount.toNumber()
      : originalTransaction.amount.toNumber();
    const newBalanceChange = data.type === "EXPENSE" ? -data.amount : data.amount;
    const netBalanceChange = newBalanceChange - oldBalanceChange;

    // Update in transaction
    const [transaction] = await db.$transaction([
      db.transaction.update({
        where: { id, userId: user.id },
        data: {
          ...data,
          nextRecurringDate: data.isRecurring && data.recurringInterval
            ? calculateNextRecurringDate(data.date, data.recurringInterval)
            : null,
        },
      }),
      db.account.update({
        where: { id: data.accountId },
        data: { balance: { increment: netBalanceChange } },
      }),
    ]);

    revalidatePath("/dashboard");
    revalidatePath(`/account/${data.accountId}`);

    return { 
      success: true, 
      data: serializeAmount(transaction) 
    };
  } catch (error) {
    console.error("Error updating transaction:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

export async function getUserTransactions(query = {}) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findFirst({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const transactions = await db.transaction.findMany({
      where: {
        userId: user.id,
        ...query,
      },
      include: {
        account: true,
      },
      orderBy: {
        date: "desc",
      },
    });

    return { 
      success: true, 
      data: transactions.map(serializeAmount) 
    };
  } catch (error) {
    console.error("Error getting transactions:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

export async function scanReceipt(file) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const arrayBuffer = await file.arrayBuffer();
    const base64String = Buffer.from(arrayBuffer).toString("base64");

    const prompt = `...`; // Keep your existing prompt

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      },
      prompt,
    ]);

    const response = await result.response;
    const text = response.text();
    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

    try {
      const data = JSON.parse(cleanedText);
      return {
        amount: parseFloat(data.amount),
        date: new Date(data.date),
        description: data.description,
        category: data.category,
        merchantName: data.merchantName,
      };
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
      throw new Error("Invalid receipt format");
    }
  } catch (error) {
    console.error("Receipt scan failed:", error);
    throw new Error("Failed to process receipt");
  }
}

function calculateNextRecurringDate(startDate, interval) {
  const date = new Date(startDate);
  switch (interval) {
    case "DAILY": date.setDate(date.getDate() + 1); break;
    case "WEEKLY": date.setDate(date.getDate() + 7); break;
    case "MONTHLY": date.setMonth(date.getMonth() + 1); break;
    case "YEARLY": date.setFullYear(date.getFullYear() + 1); break;
  }
  return date;
}