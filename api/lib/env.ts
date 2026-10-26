import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  // 本应用不使用数据库与鉴权；Kimi 平台会注入这些变量，自部署时缺失也照常启动
  if (!value && process.env.NODE_ENV === "production") {
    console.warn(`[env] ${name} 未设置（本应用未使用，可忽略）`);
  }
  return value ?? "";
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
};
