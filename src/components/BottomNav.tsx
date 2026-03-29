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
    bottom: 14,
    left: 16,
    right: 16,
    maxWidth: 560,
    margin: '0 auto',
    display: 'flex',
    background: 'rgba(10, 18, 32, 0.88)',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    borderRadius: 24,
    boxShadow: '0 18px 50px rgba(3, 10, 24, 0.45)',
    backdropFilter: 'blur(18px)',
    zIndex: 100,
  },
  tab: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 0 12px',
    cursor: 'pointer',
    fontSize: 20,
    gap: 4,
    transition: 'transform 160ms ease, color 160ms ease',
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.02em',
  },
};

export const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav style={styles.nav}>
      {TABS.map(tab => {
        const active = pathname === tab.path;
        const color = active ? '#f5f7fb' : '#7f8ba3';
        return (
          <div
            key={tab.path}
            style={{
              ...styles.tab,
              color,
              transform: active ? 'translateY(-2px)' : 'translateY(0)',
            }}
            onClick={() => navigate(tab.path)}
          >
            <div style={{
              minWidth: 42,
              height: 34,
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              background: active ? 'linear-gradient(135deg, rgba(47,125,246,0.98), rgba(21,94,239,0.98))' : 'transparent',
              boxShadow: active ? '0 10px 20px rgba(47, 125, 246, 0.28)' : 'none',
            }}>
              {tab.icon}
            </div>
            <span style={styles.label}>{tab.label}</span>
          </div>
        );
      })}
    </nav>
  );
};
