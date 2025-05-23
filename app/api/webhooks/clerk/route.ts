import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
        throw new Error(
            "Please add WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local"
        );
    }

    const headerPayload = await headers();
    const svix_id = headerPayload.get("svix-id");
    const svix_timestamp = headerPayload.get("svix-timestamp");
    const svix_signature = headerPayload.get("svix-signature");

    if (!svix_id || !svix_timestamp || !svix_signature) {
        return new Response("Error occurred -- no svix headers", {
            status: 400,
        });
    }

    const payload = await req.json();
    const body = JSON.stringify(payload);

    const wh = new Webhook(WEBHOOK_SECRET);
    let evt: WebhookEvent;
    try {
        evt = wh.verify(body, {
            "svix-id": svix_id,
            "svix-timestamp": svix_timestamp,
            "svix-signature": svix_signature,
        }) as WebhookEvent;
    } catch (err) {
        console.error("Error verifying webhook:", err);
        return new Response("Error occurred", {
            status: 400,
        });
    }

    const { id } = evt.data;
    const eventType = evt.type;

    console.log(`Webhook with an ID of ${id} and type of ${eventType}`);
    console.log("Webhook body:", body);

    if (eventType === "user.created") {
        try {
            const { email_addresses, primary_email_address_id } = evt.data;
            console.log(evt.data);

            const primaryEmail = email_addresses.find(
                (email) => email.id === primary_email_address_id
            );
            console.log("Primary email:", primaryEmail);
            console.log("Email addresses:", primaryEmail?.email_address);

            if (!primaryEmail) {
                console.error("No primary email found");
                return new Response("No primary email found", { status: 400 });
            }

            const newUser = await prisma.user.create({
                data: {
                    id: evt.data.id!,
                    email: primaryEmail.email_address,
                    firstName: evt.data.first_name ?? null,
                    lastName: evt.data.last_name ?? null,
                },
            });
            console.log("New user created:", newUser);
        } catch (error) {
            console.error("Error creating user in database:", error);
            return new Response("Error creating user", { status: 500 });
        }
    }

    if (eventType === "user.updated") {
        try {
            const { email_addresses, primary_email_address_id, first_name, last_name, id } = evt.data;

            const primaryEmail = email_addresses.find(
                (email) => email.id === primary_email_address_id
            );

            if (!primaryEmail) {
                console.error("No primary email found");
                return new Response("No primary email found", { status: 400 });
            }

            const existingUser = await prisma.user.findUnique({
                where: { id: id },
            });

            if (!existingUser) {
                console.warn(`User with ID ${id} not found, cannot update.`);
                return new Response("User not found, cannot update", { status: 404 });
            }

            const updatedUser = await prisma.user.update({
                where: { id: id },
                data: {
                    email: primaryEmail.email_address,
                    firstName: first_name ?? null,
                    lastName: last_name ?? null,
                },
            });

            console.log("User updated:", updatedUser);
        } catch (error) {
            console.error("Error updating user in database:", error);
            return new Response("Error updating user", { status: 500 });
        }
    }

    if (eventType === "user.deleted") {
        try {
            const userToDelete = await prisma.user.findUnique({
                where: { id: evt.data.id },
            });

            if (!userToDelete) {
                console.warn(`User with ID ${evt.data.id} not found, skipping delete.`);
                return new Response("User not found, skipping delete", { status: 200 });
            }

            await prisma.user.delete({
                where: { id: evt.data.id },
            });

            console.log(`User with ID ${evt.data.id} deleted from database.`);
        } catch (error) {
            console.error("Error deleting user in database:", error);
            return new Response("Error deleting user", { status: 500 });
        }
    }

    return new Response("Webhook received successfully", { status: 200 });
}