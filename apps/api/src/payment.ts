/* import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { ApiHandler, Logger, Router } from "seyfert";
import { logger as loggerMiddleware } from "hono/logger";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { env } from "@repo/env";
import crypto from "node:crypto";
import { updatePremium } from "@repo/db";
import { subscriptions, config } from "@repo/config";


const PaymentRequestSchema = z.object({
	amount: z.number(),
	currency: z.string(),
	orderId: z.string(),
	email: z.string(),
});

const app = new Hono();
const logger = new Logger({
	name: "API",
});
const router = new Router(
	new ApiHandler({
		token: env.DISCORD_APP_TOKEN!,
	}),
).createProxy();

const webhook = router.webhooks(config.webhooks.cryptopremium.id)(config.webhooks.cryptopremium.token);

app.use(loggerMiddleware());
app.post("/create-payment", zValidator("json", PaymentRequestSchema), async (c) => {
	try {
		const body = c.req.valid("json");
		const response = await fetch("https://api.oxapay.com/merchants/request", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				merchant: env.OXAPAY_MERCHANT_KEY,
				amount: body.amount,
				currency: body.currency,
				lifeTime: 30,
				feePaidByPayer: 0,
				underPaidCover: 2.5,
				callbackUrl: `${env.API_URL}/callback`,
				returnUrl: `${env.API_URL}/success`,
				description: `Order #${body.orderId}`,
				orderId: body.orderId,
				email: body.email,
			}),
		});
		const data = await response.json();
		if (response.status !== 200) {
			return c.json({ success: false, error: data.message }, 500);
		}
		return c.json({ success: true, data });
	} catch (error: any) {
		return c.json({ success: false, error: error.message }, 500);
	}
});

app.post("/callback", async (c) => {
	const postData = await c.req.text();
	const hmacHeader = c.req.header("hmac");

	try {
		const data = JSON.parse(postData);
		const apiSecretKey = env.OXAPAY_MERCHANT_KEY;
		if (!env.OXAPAY_MERCHANT_KEY) throw new Error("OXAPAY_MERCHANT_KEY is missing!");
		const calculatedHmac = crypto.createHmac("sha512", apiSecretKey!).update(postData).digest("hex");

		if (calculatedHmac === hmacHeader) {
			if (data.type === "payment") {
				const userId = data.email.split("@")[0];
				const status = data.status;
				const user = await router.users(userId).get();
				// send notification to user for payment confirmation
				const channel = await router.users("@me").channels.post({
					body: {
						recipient_id: userId,
					},
				});

				if (status === "Waiting") {
					await webhook.post({
						body: {
							embeds: [
								{
									title: "",
									description: `Payment of \`${data.amount}\` \`${data.currency}\` for order \`#${data.orderId}\` is being processed.`,
									color: 0xffb500,
								},
							],
							username: user.username,
							avatar_url: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
						},
					});

					await router
						.channels(channel.id)
						.messages.post({
							body: {
								embeds: [
									{
										title: "Payment Waiting",
										description: `Your payment of \`${data.amount}\` \`${data.currency}\` for order \`#${data.orderId}\` has been processed.`,
										color: 0xffb500,
									},
								],
							},
						})
						.catch(() => null);
				} else if (status === "Confirming") {
					await router
						.channels(channel.id)
						.messages.post({
							body: {
								embeds: [
									{
										title: "Payment Confirming",
										description: `Your payment of \`${data.amount}\` \`${data.currency}\` for order \`#${data.orderId}\` has been confirming via blockchain. Please wait for a few minutes.`,
										color: 0x0900ff,
									},
								],
							},
						})
						.catch(() => null);

					await webhook.post({
						body: {
							embeds: [
								{
									title: "Payment Confirming",
									description: `Payment of \`${data.amount}\` \`${data.currency}\` for order \`#${data.orderId}\` has been confirming via blockchain. Please wait for a few minutes.`,
									color: 0x0900ff,
								},
							],
							username: user.username,
							avatar_url: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
						},
					});
				} else if (status === "Paid") {
					// get tier name by amount
					const tier = subscriptions.find((s) => s.amount === Number(data.amount));
					if (!tier) {
						return c.json({ success: false, error: "Invalid subscription amount" }, 400);
					}
					// expires in 30 days by payDate + 30 days
					const expiresAt = new Date().getTime() + 30 * 24 * 60 * 60 * 1000;
					// save to database
					await updatePremium(userId, {
						tier: tier!.name,
						expiresAt: expiresAt,
						totalServers: tier!.server,
						paymentMethod: "Crypto",
						premiumSince: new Date().getTime(),
					});

					await webhook.post({
						body: {
							embeds: [
								{
									title: "Payment Confirmed",
									description: `Payment of \`${data.amount}\` \`${data.currency}\` for order \`#${data.orderId}\` has been confirmed.`,
									color: 0x00ff00,
								},
							],
							username: user.username,
							avatar_url: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
						},
					});

					await router
						.channels(channel.id)
						.messages.post({
							body: {
								embeds: [
									{
										title: "Payment Confirmed",
										description: `Payment of \`${data.amount}\` \`${data.currency}\` for order \`#${data.orderId}\` has been confirmed.`,
										color: 0x00ff00,
									},
								],
							},
						})
						.catch(() => null);
				} else if (status === "Expired") {
					await webhook.post({
						body: {
							embeds: [
								{
									title: "Payment Expired",
									description: `Payment of \`${data.amount}\` \`${data.currency}\` for order \`#${data.orderId}\` has been expired.`,
									color: 0xff0000,
								},
							],
							username: user.username,
							avatar_url: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
						},
					});

					await router
						.channels(channel.id)
						.messages.post({
							body: {
								embeds: [
									{
										title: "Payment Expired",
										description: `Payment of \`${data.amount}\` \`${data.currency}\` for order \`#${data.orderId}\` has been expired.`,
										color: 0xff0000,
									},
								],
							},
						})
						.catch(() => null);
				}
			}
			console.log("Payment Data:", data);
			c.status(200);
			return c.text("OK");
		}
		return c.text("Invalid HMAC signature", 400);
	} catch (error) {
		return c.text("Invalid JSON data", 400);
	}
});
app.post("/success", async (c) => {
	try {
		const payload = await c.req.json();
		console.log("Payment Success:", payload);
		return c.text("OK");
	} catch (error: any) {
		return c.json({ success: false, error: error.message }, 500);
	}
});

app.get("/", (c) => c.text("Hello World"));
serve(
	{
		fetch: app.fetch,
		port: 5173,
	},
	(address) => {
		logger.info(`is running on ${address.port}`);
	},
);

export default app;
 */