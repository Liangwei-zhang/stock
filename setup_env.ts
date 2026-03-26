(global as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
};
(global as any).window = { localStorage: (global as any).localStorage };
