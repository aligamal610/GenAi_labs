import "dotenv/config";
import nodemailer from "nodemailer";
import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";

const DEFAULT_TO = process.env.REMINDER_TO;


const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const sendEmailReminder = tool({
  name: "send_email_reminder",
  description: "Send or schedule an email reminder at a specific ISO datetime.",
  parameters: z.object({
    to: z.string().email(),
    task: z.string(),
    sendAtISO: z.string().describe("ISO8601 datetime. Example: 2025-12-25T10:00:00Z"),
  }),
  async execute({ to, task, sendAtISO }) {
    to = to || process.env.REMINDER_TO;
    const t = Date.parse(sendAtISO);
    if (Number.isNaN(t)) return `Invalid date: ${sendAtISO}`;

    const subject = "Reminder";
    const body = `Task: ${task}\nTime: ${sendAtISO}`;

    const sendNow = async () => {
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to,
        subject,
        text: body,
      });
    };

    const delay = t - Date.now();
    if (delay <= 0) {
      await sendNow();
      return `Sent immediately to ${to}.`;
    }

    setTimeout(() => sendNow().catch(console.error), delay);
    return `Scheduled reminder to ${to} at ${sendAtISO}.`;
  },
});

const agent = new Agent({
  name: "Reminder Agent",
  instructions: `
You create reminders.
If user doesn't provide an email, use this default email: ${DEFAULT_TO}.
You MUST call send_email_reminder with to, task, sendAtISO.
`,
  model: "gpt-4o-mini",
  tools: [sendEmailReminder],
});

async function main() {
  const input = process.argv.slice(2).join(" ") || "Please remind me tomorrow at 7pm to submit the assignment.";
  const result = await run(agent, input);
  console.log(result.finalOutput);
}

main().catch(console.error);
