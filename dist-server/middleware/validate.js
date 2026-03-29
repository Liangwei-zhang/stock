/**
 * Zod 參數校驗中間件
 * @param schema Zod schema
 * @param target 校驗對象：'body' | 'query' | 'params'
 */
export function validate(schema, target = 'body') {
    return (req, res, next) => {
        const result = schema.safeParse(req[target]);
        if (!result.success) {
            const errors = result.error.issues.map(e => ({
                field: e.path.join('.'),
                message: e.message,
            }));
            return res.status(400).json({ error: '請求參數有誤', details: errors });
        }
        // 將驗證後的值回寫（strip unknown fields）
        req[target] = result.data;
        next();
    };
}
//# sourceMappingURL=validate.js.map