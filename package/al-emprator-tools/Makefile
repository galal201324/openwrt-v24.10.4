include $(TOPDIR)/rules.mk

PKG_NAME:=al-emprator-tools
PKG_VERSION:=2.0
PKG_RELEASE:=1
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)
PKGARCH:=all
PKG_LICENSE:=GPL-3.0-only

include $(INCLUDE_DIR)/package.mk

define Package/al-emprator-tools
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=AL-emprator Router Tools
  DEPENDS:=+libc
endef

define Package/al-emprator-tools/description
 AL-emprator router management tools.
 Provides MAC address utility, EEPROM manager, wireless/network
 configuration helpers, LED control, and mesh button handlers.
 Pure shell-script implementation — architecture independent.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/al-emprator-tools/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/usr/bin/alemprator $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_c $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_f $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_l $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_m $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_m_l $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_s $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alempratore $(1)/usr/bin/
	$(INSTALL_DIR) $(1)/etc/rc.button
	$(INSTALL_BIN) ./files/etc/rc.button/led $(1)/etc/rc.button/
	$(INSTALL_BIN) ./files/etc/rc.button/wps $(1)/etc/rc.button/
endef

$(eval $(call BuildPackage,al-emprator-tools))
