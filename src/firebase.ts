import admin from "firebase-admin";
import fs from "node:fs";
import { config } from "./config";

function initializeFirebase(): admin.app.App {
  if (admin.apps.length) return admin.app();

  if (config.firebaseServiceAccountBase64) {
    const json = Buffer.from(config.firebaseServiceAccountBase64, "base64").toString("utf8");
    const serviceAccount = JSON.parse(json) as admin.ServiceAccount;
    return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  if (config.firebaseServiceAccountPath && fs.existsSync(config.firebaseServiceAccountPath)) {
    const serviceAccount = JSON.parse(
      fs.readFileSync(config.firebaseServiceAccountPath, "utf8")
    ) as admin.ServiceAccount;
    return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  // Supports GOOGLE_APPLICATION_CREDENTIALS / Application Default Credentials.
  return admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const app = initializeFirebase();
export const firestore = app.firestore();
export const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;