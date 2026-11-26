/** 관리자 화면 공용 컨텍스트 (순환 참조 방지를 위해 별도 모듈) */
import { createContext, useContext } from 'react';
import type { AdminService, Category } from '../types';

export interface AdminCtx {
  services: AdminService[];
  categories: Category[];
  allowedDomains: string[];
  reloadServices: () => Promise<void>;
  rev: number;
}
export const AdminContext = createContext<AdminCtx>({ services: [], categories: [], allowedDomains: [], reloadServices: async () => undefined, rev: 0 });
export const useAdmin = () => useContext(AdminContext);
