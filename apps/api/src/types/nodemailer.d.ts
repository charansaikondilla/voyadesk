/** Minimal typing for the part of nodemailer used here (v10 ships without type definitions). */
declare module "nodemailer" {
  interface Transport {
    sendMail(message: { from: string; to: string; subject: string; text: string; html?: string }): Promise<{ messageId?: string }>;
  }
  const nodemailer: {
    createTransport(options: { host: string; port: number; secure: boolean; auth?: { user: string; pass: string } }): Transport;
  };
  export default nodemailer;
}
