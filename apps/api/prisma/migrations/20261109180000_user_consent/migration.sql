-- 协议同意留痕：用户 + 类型 + 版本唯一
CREATE TABLE "UserConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "agreedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserConsent_userId_type_version_key" ON "UserConsent"("userId", "type", "version");
CREATE INDEX "UserConsent_userId_idx" ON "UserConsent"("userId");

ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
