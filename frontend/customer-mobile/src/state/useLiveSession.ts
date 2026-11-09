import {Platform} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {create} from 'zustand';
import axios from 'axios';
import {apiBase, configureApiSession, wire,MobileInputError} from '../api/client';
import {loginBody, mapCurrentUser, mapLogin} from '../api/contracts/customer';

type Credentials = {accessToken: string; refreshToken: string};
type Customer = ReturnType<typeof mapCurrentUser>;
type Session = {
  user: Customer | null; restoring: boolean; restoreFailed: boolean;
  restore: () => Promise<void>; reloadUser: (owner:string) => Promise<void>; login: (values: unknown) => Promise<void>; logout: () => Promise<void>;
};

const sessionKey = 'wdp.customer.session.v1';
let credentials: Credentials | undefined;
let revision = 0;
let storageQueue = Promise.resolve();
const writeSession = (next?: Credentials) => {
  if (Platform.OS === 'web') return Promise.resolve();
  const operation = storageQueue.then(() => next
    ? SecureStore.setItemAsync(sessionKey, JSON.stringify({base:apiBase,...next}))
    : SecureStore.deleteItemAsync(sessionKey).catch(() => SecureStore.setItemAsync(sessionKey, "{}")));
  storageQueue = operation.catch(() => {});
  return operation;
};

export const useLiveSession = create<Session>((set,get) => {
  function clear() {
    revision++;
    credentials = undefined;
    configureApiSession();
    set({user:null, restoring:false, restoreFailed:false});
    return writeSession();
  }

  function activate(next: Credentials, user: Customer) {
    credentials = next;
    configureApiSession(next.accessToken, () => { void clear().catch(() => {}); });
    set({user, restoring:false, restoreFailed:false});
  }

  return {
    user:null, restoring:true, restoreFailed:false,
    async restore() {
      const current = ++revision;
      set({restoring:true,restoreFailed:false});
      try {
        if (Platform.OS === 'web') return;
        await storageQueue;
        const raw = await SecureStore.getItemAsync(sessionKey);
        if (!raw || current !== revision) return;
        const saved = JSON.parse(raw) as Partial<Credentials> & {base?: string};
        if (!apiBase || saved.base !== apiBase || typeof saved.accessToken !== 'string' || typeof saved.refreshToken !== 'string' ||
            !saved.accessToken || !saved.refreshToken || /\s/.test(saved.accessToken + saved.refreshToken)) {
          await clear();
          return;
        }
        const next = {accessToken:saved.accessToken, refreshToken:saved.refreshToken};
        const user = mapCurrentUser(await wire('GET','/users/me',{token:next.accessToken}));
        if (current === revision) activate(next,user);
      } catch (error) {
        if (current !== revision) return;
        if (axios.isAxiosError(error) && [401,403].includes(error.response?.status ?? 0)) {
          await clear().catch(() => {});
        } else {
          set({restoreFailed:true});
        }
      } finally {
        if (current === revision) set({restoring:false});
      }
    },
    async login(values) {
      const current = ++revision;
      const result = mapLogin(await wire('POST','/auth/login',{anonymous:true,body:loginBody.parse(values)}));
      const next = {accessToken:result.accessToken, refreshToken:result.refreshToken};
      if (/\s/.test(next.accessToken + next.refreshToken)) throw new MobileInputError('Thông tin phiên không hợp lệ.');
      const user = mapCurrentUser(await wire('GET','/users/me',{token:next.accessToken}));
      if (user._id !== result.user._id || current !== revision) throw new MobileInputError('Không xác minh được tài khoản.');
      await writeSession(next);
      if (current === revision) activate(next,user);
    },
    async reloadUser(owner) {
      const current=revision;
      if(get().user?._id!==owner)throw new MobileInputError('Phiên đăng nhập đã thay đổi.');
      const user=mapCurrentUser(await wire('GET','/users/me'));
      if(user._id!==owner||current!==revision)throw new MobileInputError('Không xác minh được tài khoản.');
      set({user});
    },
    async logout() {
      const previous = credentials;
      const revoke = previous && wire('POST','/auth/logout',{
        token:previous.accessToken, body:{refreshToken:previous.refreshToken},
      }).catch(() => undefined);
      await clear();
      await revoke;
    },
  };
});
