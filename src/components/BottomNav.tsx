import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { HomeOutlined, StarOutlined, LineChartOutlined, SettingOutlined } from '@ant-design/icons';
import { useI18n } from '../i18n';

const TABS = [
  { path: '/',           labelKey: 'nav.home',      icon: <HomeOutlined /> },
  { path: '/watchlist',  labelKey: 'nav.watchlist', icon: <StarOutlined /> },
  { path: '/portfolio',  labelKey: 'nav.portfolio', icon: <LineChartOutlined /> },
  { path: '/settings',   labelKey: 'nav.settings',  icon: <SettingOutlined /> },
] as const;

const styles: Record<string, React.CSSProperties> = {
  nav: {
    position: 'fixed',
    bottom: 14,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    alignItems: 'center',
    width: 'min(392px, calc(100vw - 24px))',
    gap: 6,
    padding: '6px',
    background: 'rgba(255, 255, 255, 0.9)',
    border: '1px solid rgba(84, 155, 108, 0.16)',
    borderRadius: 24,
    boxShadow: '0 18px 42px rgba(101, 139, 113, 0.16)',
    backdropFilter: 'blur(22px)',
    zIndex: 100,
  },
  tab: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 62,
    padding: '8px 0 7px',
    cursor: 'pointer',
    fontSize: 17,
    gap: 6,
    transition: 'transform 180ms ease, color 180ms ease, background 180ms ease, box-shadow 180ms ease',
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.1,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    textAlign: 'center',
    fontFamily: 'Aptos, Avenir Next, SF Pro Display, Segoe UI Variable Display, Segoe UI, Helvetica Neue, Arial, sans-serif',
  },
  iconWrap: {
    width: 30,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    borderRadius: 12,
  },
};

export const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useI18n();

  return (
    <nav style={styles.nav}>
      {TABS.map(tab => {
        const active = pathname === tab.path;
        const color = active ? '#123d28' : '#6b8476';
        return (
          <div
            key={tab.path}
            style={{
              ...styles.tab,
              color,
              borderRadius: 18,
              transform: active ? 'translateY(-1px)' : 'translateY(0)',
              background: active ? 'linear-gradient(145deg, rgba(103, 201, 138, 0.22), rgba(243, 249, 245, 0.98))' : 'transparent',
              border: active ? '1px solid rgba(84, 155, 108, 0.2)' : '1px solid transparent',
              boxShadow: active ? '0 10px 22px rgba(103, 201, 138, 0.14)' : 'none',
            }}
            onClick={() => navigate(tab.path)}
          >
            <div style={{
              ...styles.iconWrap,
              background: active ? 'rgba(255, 255, 255, 0.86)' : 'rgba(102, 142, 117, 0.08)',
            }}>
              {tab.icon}
            </div>
            <span style={{ ...styles.label, fontWeight: active ? 700 : 600 }}>{t(tab.labelKey)}</span>
          </div>
        );
      })}
    </nav>
  );
};
