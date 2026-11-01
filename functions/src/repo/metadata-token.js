'use strict';
// Tiny token service for ydb-sdk MetadataAuthService (compat interface: getToken + initialize).
// Avoids the optional peer dependency @yandex-cloud/nodejs-sdk.
const URL_ = 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';
class MetadataTokenService {
  constructor() { this.token = null; this.expiresAt = 0; }
  getToken() { return this.token && Date.now() < this.expiresAt ? this.token : null; }
  async initialize() {
    const res = await fetch(URL_, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!res.ok) throw new Error('metadata token: HTTP ' + res.status);
    const data = await res.json();
    this.token = data.access_token;
    const ttl = Math.max(60, Number(data.expires_in) || 300);
    this.expiresAt = Date.now() + (ttl - 60) * 1000;
  }
}
module.exports = { MetadataTokenService };
