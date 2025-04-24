import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 9000;
export const JWT_SECRET = process.env.JWT_SECRET || "JWT_SECRET";

export const TEST_MODE = true;
export const MONGO_URL = process.env.MONGO_URI;

export const MEMPOOL_API = TEST_MODE
  ? "https://mempool.space/testnet4/api"
  : "https://mempool.space/api";