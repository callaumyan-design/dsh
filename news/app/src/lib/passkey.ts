import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { api } from './api';
import { useStore } from './store';
import { adoptLocalData, sync } from './sync';

export const passkeySupported = () => browserSupportsWebAuthn();

function friendly(err: unknown): Error {
  const e = err as { name?: string; message?: string };
  if (e?.name === 'NotAllowedError') return new Error('已取消，或者这台设备上没有可用的通行密钥');
  if (e?.name === 'InvalidStateError') return new Error('这台设备上已经有这个账号的通行密钥了');
  return new Error(e?.message ?? '操作失败');
}

/** 新建账号；已登录时则是给当前账号在这台设备上添加通行密钥。 */
export async function registerPasskey(name: string) {
  const { token } = useStore.getState();
  const { challengeId, options } = await api.registerOptions(name, token);
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (err) {
    throw friendly(err);
  }
  const res = await api.registerVerify(challengeId, response, token);
  if (!token) {
    useStore.getState().setSession(res.token, res.user);
    adoptLocalData();
  }
  await sync();
}

export async function loginWithPasskey() {
  const { challengeId, options } = await api.loginOptions();
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (err) {
    throw friendly(err);
  }
  const res = await api.loginVerify(challengeId, response);
  useStore.getState().setSession(res.token, res.user);
  adoptLocalData();
  await sync();
}

export async function logout() {
  const { token } = useStore.getState();
  useStore.getState().clearSession();
  if (token) await api.logout(token).catch(() => {});
}
