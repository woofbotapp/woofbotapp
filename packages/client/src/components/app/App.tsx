import React from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';

import { pageRoutes } from '../../routes';
import Login from '../login/Login';
import ChangePassword from '../change-password/ChangePassword';
import Dashboard from '../dashboard/Dashboard';
import Logout from '../logout/Logout';
import HomeContent from '../dashboard/HomeContent';

export default function App() {
  return (
    <Routes>
      <Route path={pageRoutes.login} element={<Login />} />
      <Route path={pageRoutes.changePassword} element={<ChangePassword />} />
      <Route path={pageRoutes.logout} element={<Logout />} />
      <Route path={pageRoutes.home} element={<Dashboard />}>
        <Route index element={<HomeContent />} />
      </Route>
      <Route path="*" element={<Navigate to={pageRoutes.home} replace />} />
    </Routes>
  );
}
