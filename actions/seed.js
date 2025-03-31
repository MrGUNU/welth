"use server";

import { db } from "@/lib/prisma";
import { subDays } from "date-fns";

const ACCOUNT_ID = "8e9de477-116a-4394-9d9f-c295813af632";
const USER_ID = "2817d31d-5dfc-4059-9c71-5c4becacb5c4";

// Categories configuration (keep your existing)
const CATEGORIES = {
  INCOME: [
    { name: "salary", range: [5000, 8000] },
    { name: "freelance", range: [1000, 3000] },
    { name: "investments", range: [500, 2000] },
    { name: "other-income", range: [100, 1000] },
  ],
  EXPENSE: [
    { name: "housing", range: [1000, 2000] },
    { name: "transportation", range: [100, 500] },
    { name: "groceries", range: [200, 600] },
    { name: "utilities", range: [100, 300] },
    { name: "entertainment", range: [50, 200] },
    { name: "food", range: [50, 150] },
    { name: "shopping", range: [100, 500] },
    { name: "healthcare", range: [100, 1000] },
    { name: "education", range: [200, 1000] },
    { name: "travel", range: [500, 2000] },
  ],
};

// Helper functions (keep your existing)
function getRandomAmount(min, max) {
  return Number((Math.random() * (max - min) + min).toFixed(2));
}

function getRandomCategory(type) {
  const categories = CATEGORIES[type];
  const category = categories[Math.floor(Math.random() * categories.length)];
  const amount = getRandomAmount(category.range[0], category.range[1]);
  return { category: category.name, amount };
}

export async function seedTransactions() {
  try {
    // 1. First verify the account exists using findFirst (not findUnique)
    const account = await db.account.findFirst({
      where: {
        id: ACCOUNT_ID,
        userId: USER_ID
      },
      select: {
        id: true,
        balance: true
      }
    });

    if (!account) {
      throw new Error(`Account ${ACCOUNT_ID} not found for user ${USER_ID}`);
    }

    // 2. Generate transactions
    const transactions = [];
    let balanceChange = 0;

    for (let i = 90; i >= 0; i--) {
      const date = subDays(new Date(), i);
      const transactionsPerDay = Math.floor(Math.random() * 3) + 1;

      for (let j = 0; j < transactionsPerDay; j++) {
        const type = Math.random() < 0.4 ? "INCOME" : "EXPENSE";
        const { category, amount } = getRandomCategory(type);
        const signedAmount = type === "INCOME" ? +amount : -amount;

        transactions.push({
          type,
          amount: Math.abs(signedAmount), // Store absolute value
          description: `${type === "INCOME" ? "Received" : "Paid for"} ${category}`,
          date,
          category,
          status: "COMPLETED",
          userId: USER_ID,
          accountId: ACCOUNT_ID,
          createdAt: date,
          updatedAt: date,
        });

        balanceChange += signedAmount;
      }
    }

    // 3. Execute as a transaction
    const result = await db.$transaction([
      // Delete existing transactions
      db.transaction.deleteMany({
        where: { accountId: ACCOUNT_ID }
      }),
      
      // Create new transactions
      db.transaction.createMany({
        data: transactions
      }),
      
      // Update account balance
      db.account.update({
        where: { id: ACCOUNT_ID },
        data: { 
          balance: Number(account.balance) + balanceChange,
          updatedAt: new Date()
        }
      })
    ]);

    return {
      success: true,
      transactionsCreated: result[1].count,
      balanceUpdated: result[2].balance
    };

  } catch (error) {
    console.error("Seeding failed:", error);
    return {
      success: false,
      error: error.message,
      ...(process.env.NODE_ENV === "development" && { stack: error.stack })
    };
  }
}