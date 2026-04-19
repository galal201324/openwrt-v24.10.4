include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-setup
PKG_VERSION:=1.0
PKG_RELEASE:=47
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)
PKGARCH:=all
PKG_LICENSE:=GPL-3.0-only

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-setup
  SECTION:=luci
  CATEGORY:=LuCI
	TITLE:=LuCI Support for ALemprator Setup
	DEPENDS:=+luci-base +luci-theme-bootstrap +rpcd
endef

define Package/luci-app-setup/description
 Portable ALemprator LuCI frontend for standard OpenWrt LAN, Wi-Fi and button policies.
 Optional backend binaries may still be used on targets where they are available.
endef

define Package/luci-app-setup/conffiles
/etc/config/setup
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/luci-app-setup/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/setup $(1)/etc/config/
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/setup $(1)/etc/init.d/
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/40_luci-app-setup $(1)/etc/uci-defaults/
	$(INSTALL_BIN) ./files/etc/uci-defaults/45_luci-app-setup-migrate-wizardvlan $(1)/etc/uci-defaults/
	$(INSTALL_BIN) ./files/etc/uci-defaults/alemprator_c $(1)/etc/uci-defaults/
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-setup.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DIR) $(1)/usr/share/ucitrack
	$(INSTALL_DATA) ./files/usr/share/ucitrack/luci-app-setup.json $(1)/usr/share/ucitrack/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/luci-app-setup.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/setup
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/setup/setup.js $(1)/www/luci-static/resources/view/setup/
	$(INSTALL_DIR) $(1)/usr/libexec/alemprator-setup
	$(INSTALL_BIN) ./files/usr/libexec/alemprator-setup/reset-disabled $(1)/usr/libexec/alemprator-setup/
	$(INSTALL_BIN) ./files/usr/libexec/alemprator-setup/wps-disabled $(1)/usr/libexec/alemprator-setup/
	$(INSTALL_DIR) $(1)/etc/rc.d
	$(LN) ../init.d/setup $(1)/etc/rc.d/S99setup
endef

$(eval $(call BuildPackage,luci-app-setup))