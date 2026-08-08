import { db } from "./supabase.js";

export async function getCurrentUser() {
    const { data } = await db.auth.getUser();
    return data.user;
}

export async function signOut() {
    await db.auth.signOut();
}