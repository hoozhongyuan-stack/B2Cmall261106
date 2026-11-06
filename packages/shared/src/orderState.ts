/**
 * 订单与售后状态机：全项目唯一实现（工程契约 R4）
 * 前端只读同一张表做按钮显隐；服务端用它做强制校验。
 */

export const ORDER_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  SHIPPED: 'SHIPPED',
  COMPLETED: 'COMPLETED',
  REFUNDING: 'REFUNDING',
  REFUNDED: 'REFUNDED',
  CLOSED: 'CLOSED',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_ACTIONS = {
  paySuccess: 'pay_success',
  cancel: 'cancel',
  ship: 'ship',
  confirm: 'confirm',
  refundApply: 'refund_apply',
  refundSuccess: 'refund_success',
  refundPartialSuccess: 'refund_partial_success',
  refundReject: 'refund_reject',
} as const;

export type OrderAction = (typeof ORDER_ACTIONS)[keyof typeof ORDER_ACTIONS];

/** 目标为 PREVIOUS 时，需调用方传入申请前的状态 */
const ORDER_TRANSITIONS: Record<OrderStatus, Partial<Record<OrderAction, OrderStatus | 'PREVIOUS'>>> = {
  PENDING_PAYMENT: {
    pay_success: 'PAID',
    cancel: 'CLOSED',
  },
  PAID: {
    ship: 'SHIPPED',
    refund_apply: 'REFUNDING',
  },
  SHIPPED: {
    confirm: 'COMPLETED',
    refund_apply: 'REFUNDING',
  },
  COMPLETED: {
    refund_apply: 'REFUNDING',
  },
  REFUNDING: {
    refund_success: 'REFUNDED',
    // 部分退款：金额未退完，订单回到申请前状态，仍可继续履约
    refund_partial_success: 'PREVIOUS',
    refund_reject: 'PREVIOUS',
  },
  REFUNDED: {},
  CLOSED: {},
};

/** 售后申请前可能是这三个状态之一，拒绝时必须回到它 */
const REFUNDABLE_ORIGINS: OrderStatus[] = ['PAID', 'SHIPPED', 'COMPLETED'];

export function can(from: OrderStatus, action: OrderAction): boolean {
  return Boolean(ORDER_TRANSITIONS[from]?.[action]);
}

export function nextStatus(
  from: OrderStatus,
  action: OrderAction,
  ctx?: { previousStatus?: OrderStatus },
): OrderStatus {
  const target = ORDER_TRANSITIONS[from]?.[action];
  if (!target) throw new Error(`非法状态迁移：${from} → ${action}`);

  if (target === 'PREVIOUS') {
    const previous = ctx?.previousStatus;
    if (!previous || !REFUNDABLE_ORIGINS.includes(previous)) {
      throw new Error(`退款拒绝缺少合法的原状态，收到 ${previous ?? '空'}`);
    }
    return previous;
  }
  return target;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '待付款',
  PAID: '待发货',
  SHIPPED: '待收货',
  COMPLETED: '已完成',
  REFUNDING: '售后中',
  REFUNDED: '已退款',
  CLOSED: '已关闭',
};

/** 是否尚未发货：仅退款时库存可回滚二次销售 */
export function isBeforeShipment(status: OrderStatus): boolean {
  return status === 'PAID';
}

/** 是否已完成：评价入口以此为准 */
export function isCompleted(status: OrderStatus): boolean {
  return status === 'COMPLETED';
}

/** 买家侧可执行的操作，用于按钮显隐（不替代服务端校验） */
export function buyerActions(status: OrderStatus): OrderAction[] {
  switch (status) {
    case 'PENDING_PAYMENT':
      return ['pay_success', 'cancel'];
    case 'SHIPPED':
      return ['confirm', 'refund_apply'];
    case 'PAID':
    case 'COMPLETED':
      return ['refund_apply'];
    default:
      return [];
  }
}

/* ---------------- 售后 ---------------- */

export const AFTER_SALE_STATUS = {
  APPLIED: 'APPLIED',
  WAIT_BUYER_SHIP: 'WAIT_BUYER_SHIP',
  WAIT_SELLER_RECEIVE: 'WAIT_SELLER_RECEIVE',
  REFUNDING: 'REFUNDING',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
} as const;

export type AfterSaleStatus = (typeof AFTER_SALE_STATUS)[keyof typeof AFTER_SALE_STATUS];

export const AFTER_SALE_ACTIONS = {
  approveOnlyRefund: 'approve_only_refund',
  approveReturn: 'approve_return',
  reject: 'reject',
  buyerShip: 'buyer_ship',
  sellerReceive: 'seller_receive',
  refundSuccess: 'refund_success',
  refundFailed: 'refund_failed',
  cancel: 'cancel',
} as const;

export type AfterSaleAction =
  (typeof AFTER_SALE_ACTIONS)[keyof typeof AFTER_SALE_ACTIONS];

const AFTER_SALE_TRANSITIONS: Record<
  AfterSaleStatus,
  Partial<Record<AfterSaleAction, AfterSaleStatus>>
> = {
  APPLIED: {
    approve_only_refund: 'REFUNDING',
    approve_return: 'WAIT_BUYER_SHIP',
    reject: 'REJECTED',
    cancel: 'REJECTED',
  },
  WAIT_BUYER_SHIP: {
    buyer_ship: 'WAIT_SELLER_RECEIVE',
    cancel: 'REJECTED',
  },
  WAIT_SELLER_RECEIVE: {
    seller_receive: 'REFUNDING',
    reject: 'REJECTED',
  },
  REFUNDING: {
    refund_success: 'COMPLETED',
    refund_failed: 'REFUNDING',
  },
  COMPLETED: {},
  REJECTED: {},
};

export function canAfterSale(from: AfterSaleStatus, action: AfterSaleAction): boolean {
  return Boolean(AFTER_SALE_TRANSITIONS[from]?.[action]);
}

export function nextAfterSaleStatus(
  from: AfterSaleStatus,
  action: AfterSaleAction,
): AfterSaleStatus {
  const target = AFTER_SALE_TRANSITIONS[from]?.[action];
  if (!target) throw new Error(`非法售后迁移：${from} → ${action}`);
  return target;
}

export const AFTER_SALE_STATUS_LABEL: Record<AfterSaleStatus, string> = {
  APPLIED: '待商家审核',
  WAIT_BUYER_SHIP: '待买家寄回',
  WAIT_SELLER_RECEIVE: '待商家收货',
  REFUNDING: '退款中',
  COMPLETED: '退款完成',
  REJECTED: '已拒绝',
};
