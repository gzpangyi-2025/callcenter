export interface Role {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  permissions?: Permission[];
}

export interface Permission {
  id: number;
  name: string;
  description: string;
}

export interface User {
  id: number;
  username: string;
  displayName?: string;
  realName?: string;
  email?: string;
  phone?: string;
  role: Role | string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSearchParam {
  q: string;
}

export interface UpdateUserInfoParam {
  displayName?: string;
  realName?: string;
  email?: string;
  phone?: string;
}
