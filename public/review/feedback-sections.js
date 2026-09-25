/* AHAKUDOS Review — section registry.
   Every reviewable area has a STABLE id (never random, never nth-child). The review layer tags matching
   elements with data-feedback-id after each render, so production templates stay untouched.
   Keep ids unchanged between versions; if a class is renamed, update only the selector here. */
(function () {
  'use strict';
  const S = (id, label, pages, selector, many) => ({ id, label, pages, selector, many: !!many });
  const ALL = '*';
  window.AhaReview = window.AhaReview || {};
  window.AhaReview.sections = Object.freeze([
    // Global chrome
    S('global-header', 'Thanh menu trên cùng', [ALL], '.hb-header'),
    S('global-context-bar', 'Lời chào & tìm kiếm', [ALL], '.hb-contextbar'),
    S('global-fab', 'Nút mascot góc phải', [ALL], '.aha-floating-kudos'),
    S('global-footer', 'Footer', [ALL], '.hb-footer'),
    // Home
    S('home-welcome', 'Banner Welcome Onboard', ['employee-home'], '.welcome-onboard'),
    S('home-hero', 'Hero trang chủ', ['employee-home'], '.hb-home > .recognition-hero'),
    S('home-profile-strip', 'Dải hành trình cá nhân', ['employee-home'], '.hb-home > .profile-strip'),
    S('home-first-kudos', 'Gợi ý gửi KUDOS đầu tiên', ['employee-home'], '.home-start-card'),
    S('home-community-preview', 'Cộng đồng KUDOS (trang chủ)', ['employee-home'], '.home-community-card'),
    S('home-definition', 'Giới thiệu AHAKUDOS', ['employee-home'], '#home-about'),
    S('home-goals', 'Mục tiêu', ['employee-home'], '.home-handbook-goals'),
    S('home-kudos-sources', 'Bạn có thể nhận KUDOS từ đâu?', ['employee-home'], '.home-handbook-sources'),
    S('home-how-to-send', 'Gửi một KUDOS như thế nào?', ['employee-home'], '#home-how'),
    S('home-birthday', 'Sinh nhật đồng nghiệp sắp tới', ['employee-home'], '.home-birthday-master'),
    S('home-events', 'Thông báo sự kiện', ['employee-home'], '.home-handbook-extra > .home-handbook-mini:not(.home-birthday-master)'),
    S('home-bottom-cta', 'Lời mời gửi KUDOS (cuối trang)', ['employee-home'], '.home-handbook-bottom'),
    // Send KUDOS
    S('send-hero', 'Hero Gửi KUDOS', ['send-kudos'], '.compose-hero'),
    S('send-steps', 'Các bước gửi KUDOS', ['send-kudos'], '.hb-compose-steps'),
    S('send-type', 'Chọn loại KUDOS', ['send-kudos'], '.kudos-type-field'),
    S('send-recipient', 'Người nhận', ['send-kudos'], '.recipient-search-field'),
    S('send-background', 'Chọn background', ['send-kudos'], '.template-field'),
    S('send-message', 'Nội dung KUDOS & Format tiêu chuẩn', ['send-kudos'], '.message-field'),
    S('send-coach', 'Thư ký hỗ trợ nội dung KUDOS', ['send-kudos'], '.coach'),
    S('send-values', 'Giá trị cốt lõi', ['send-kudos'], '#culture-field'),
    S('send-preview', 'Xem trước KUDOS', ['send-kudos'], '#kudos-preview'),
    S('send-submit-area', 'Nút gửi KUDOS', ['send-kudos'], '.kudos-compose-form .form-actions'),
    // Community
    S('community-header', 'Tiêu đề Cộng đồng KUDOS', ['public-feed'], '.public-feed-head'),
    S('community-feed', 'Danh sách Cộng đồng KUDOS', ['public-feed'], '#public-feed-list'),
    S('community-card', 'Thẻ KUDOS trên Cộng đồng', ['public-feed'], '.public-kudos-card', true),
    S('community-side', 'Cột bên Cộng đồng', ['public-feed'], '.public-feed-rail'),
    // Profile
    S('profile-summary', 'Thẻ hồ sơ cá nhân', ['kudos-profile'], '.profile-card'),
    S('profile-tabs', 'Tab Đã nhận / Đã gửi', ['kudos-profile'], '.profile-grid .tabs'),
    S('profile-received', 'KUDOS đã nhận', ['kudos-profile'], '#tab-received'),
    S('profile-sent', 'KUDOS đã gửi', ['kudos-profile'], '#tab-sent'),
    // KUDOS detail
    S('detail-card', 'Thiệp KUDOS (chi tiết)', ['kudos-detail'], '.kudos-detail-page .kd-card'),
    S('detail-share', 'Chia sẻ lên Cộng đồng', ['kudos-detail'], '.kd-share-panel'),
    S('detail-replies', 'Nhắn phản hồi', ['kudos-detail'], '.kd-reply-panel'),
    S('detail-quality', 'Lời nhắc bổ sung nội dung', ['kudos-detail', 'kudos-profile'], '.quality-notice'),
    // Admin
    S('admin-subtabs', 'Tab con Admin', [ALL], '.admin-subtabs'),
    S('admin-filters', 'Bộ lọc thời gian / phòng ban', [ALL], '.dash-filter'),
    S('admin-dashboard', 'Tổng quan Admin', ['admin-home'], '.admin-grid'),
    S('admin-dashboard-overview', 'Số liệu tổng quan', ['admin-home'], '.page > article.admin-card'),
    S('admin-dept', 'Báo cáo phòng ban', ['admin-dept'], '.page > article.admin-card'),
    S('admin-culture', 'Báo cáo Giá trị cốt lõi', ['admin-culture'], '.page > article.admin-card'),
    S('admin-moderation-stats', 'Trạng thái duyệt', ['admin-quality'], '.mod-stat-row'),
    S('admin-tags', 'Tag duyệt nội dung', ['admin-quality'], '.mod-tagbar'),
    S('admin-moderation', 'Danh sách duyệt KUDOS', ['admin-quality'], '.mod-list'),
    S('admin-people-metrics', 'Số liệu nhân viên', ['admin-people'], '.metric-grid'),
    S('admin-people', 'Danh sách nhân viên', ['admin-people'], '.page > article.admin-card'),
    S('admin-recognition', 'Gửi AHAKUDOS từ Admin', ['admin-recognition'], '.admin-recognition-layout'),
    S('admin-backgrounds', 'Background dịp đặc biệt', ['admin-recognition'], '.admin-bg-upload-grid'),
    S('admin-automation', 'Tự động gửi', ['admin-ops'], '.ops-auto'),
    S('admin-milestones', 'Sinh nhật & Thâm niên', ['admin-ops'], '.milestone-ops-grid'),
    S('admin-notify', 'Cài đặt email', ['admin-notify'], '.notif-settings'),
    S('admin-notify-list', 'Danh sách email', ['admin-notify'], '.notif-list'),
    S('admin-words', 'Từ cấm', ['admin-words'], '.page > article.admin-card')
  ]);
})();
