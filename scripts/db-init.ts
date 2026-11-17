import "./env";
import { getDb } from "@/lib/db";
getDb(); // opening runs migrations
console.log("Database ready at", process.env.DATABASE_PATH || "./data/finance.db");
