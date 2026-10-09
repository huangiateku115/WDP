import axiosClient from './axiosClient';
const userApi={
 getMe:config=>axiosClient.get('/users/me/',config),
 updateProfile:({displayName,phone})=>axiosClient.put('/users/me/profile',{displayName,phone}),
 changePassword:({oldPassword,newPassword})=>axiosClient.put('/users/me/password',{oldPassword,newPassword}),
 getUsers:config=>axiosClient.get('/users',config),
 createUser:({email,password,displayName,phone,role})=>axiosClient.post('/users',{email,password,displayName,phone,role}),
 changeUserRole:(userId,role)=>axiosClient.patch(`/users/${encodeURIComponent(userId)}/role`,{role}),
 updateUser:(userId,{displayName,phone,email})=>axiosClient.put(`/users/${encodeURIComponent(userId)}`,{displayName,phone,email}),
 reactivateUser:userId=>axiosClient.patch(`/users/${encodeURIComponent(userId)}/reactivate`),
 deactivateUser:userId=>axiosClient.delete(`/users/${encodeURIComponent(userId)}`),
};
export default userApi;
