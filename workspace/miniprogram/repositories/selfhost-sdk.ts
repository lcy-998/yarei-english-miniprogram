/** HTTPS transport for the Aliyun backend. Tokens stay in memory and are never persisted. */
export type HttpRequest = (path: string, body: object, token: string | null) => Promise<unknown>;
let currentToken: string | null = null;
export function getBackendToken():string|null {return currentToken;}
export function createSelfhostSdk(request: HttpRequest) {

  const unsupported = async (): Promise<never> => { throw { code: 'PASSWORD_RECOVERY_NOT_CONFIGURED' }; };
  const auth = {
    async signInWithPassword(input: Readonly<{phone:string;password:string}>) {
      currentToken = null;
      const response = await request('/api/auth/login',input,null);
      if (!isRecord(response) || typeof response.accessToken !== 'string') return {error:{code:'INVALID_USERNAME_OR_PASSWORD'}};
      currentToken = response.accessToken;
      return {data:{authenticated:true}};
    },
    async signOut() {
      const previous = currentToken; currentToken = null;
      if (previous) await request('/api/auth/logout',{},previous);
    },
    getVerification: unsupported, verify: unsupported, resetPassword: unsupported,
  };
  return {init: (_configuration: Readonly<{env:string}>) => ({
    auth: (_options: Readonly<{persistence:'local'}>) => auth,
    async callFunction(options: Readonly<{name:string;data:object;parse:true}>) {
      if (!currentToken) throw {code:'UNAUTHENTICATED'};
      if (!/^[a-z-]+$/.test(options.name)) throw {code:'INVALID_FUNCTION'};
      const response = await request('/api/functions/'+options.name,options.data,currentToken);
      if (!isRecord(response) || !('result' in response)) throw {code:'INVALID_RESPONSE'};
      return {result:response.result};
    },
  })};
}
function isRecord(value: unknown): value is Record<string,unknown> {return typeof value==='object' && value!==null && !Array.isArray(value);}
