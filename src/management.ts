import type { User } from './types';

export function accountKind(user: User): 'manager' | 'client' | 'observer' {
  if (user.administrator) return 'manager';
  return user.attributes?.intehAccountType === 'observer' ? 'observer' : 'client';
}
export function clientIdOf(user: User): number | null {
  if (accountKind(user) === 'client') return user.id;
  const value = Number(user.attributes?.intehClientId);
  return Number.isInteger(value) && value > 0 ? value : null;
}
export function roleLabel(user: User): string {
  return user.administrator ? 'Менеджер системы' : accountKind(user) === 'client' ? 'Доступ клиента' : 'Наблюдатель';
}
export function accountPermissions(manager: boolean) {
  return {
    administrator: manager, readonly: !manager, deviceReadonly: !manager,
    userLimit: manager ? -1 : 0, deviceLimit: manager ? -1 : 0,
    limitCommands: !manager, fixedEmail: !manager,
  };
}
