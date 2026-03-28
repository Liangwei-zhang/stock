import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { HomeOutlined, StarOutlined, LineChartOutlined, SettingOutlined } from '@ant-design/icons';

const TABS = [
  { path: '/',           label: '首頁',   icon: <HomeOutlined /> },
  { path: '/watchlist',  label: '關注',   icon: <StarOutlined /> },
  { path: '/portfolio',  label: '持倉',   icon: <LineChartOutlined /> },
  { path: '/settings',   label: '設置',   icon: <SettingOutlined /> },
];

const styles: Record<string, React.CSSProperties> = {
  nav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    background: '#141414',
    borderTop: '1px solid #303030',
    zIndex: 100,
  },
  tab: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px 0 12px',
    cursor: 'pointer',
    fontSize: 20,
    gap: 2,
  },
  label: {
    fontSize: 10,
  },
};

export const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav style={styles.nav}>
      {TABS.map(tab => {
        const active = pathname === tab.path;
        const color = active ? '#1677ff' : '#8c8c8c';
        return (
          <div
            key={tab.path}
            style={{ ...styles.tab, color }}
            onClick={() => navigate(tab.path)}
          >
            {tab.icon}
            <span style={styles.label}>{tab.label}</span>
          </div>
        );
      })}
    </nav>
  );
};
