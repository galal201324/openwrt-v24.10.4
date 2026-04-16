include $(TOPDIR)/rules.mk

PKG_NAME:=alemprator-mtax
PKG_VERSION:=1.0
PKG_RELEASE:=3
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)
PKGARCH:=mipsel_24kc
PKG_LICENSE:=Proprietary

include $(INCLUDE_DIR)/package.mk

define Package/alemprator-mtax
  SECTION:=utils
  CATEGORY:=Utilities
	TITLE:=ALemprator MT AX Tools
  DEPENDS:=+libc
endef

define Package/alemprator-mtax/description
 Extracted ALemprator MT AX backend package rebuilt from device rootfs.
 This package contains prebuilt MIPS little-endian binaries for mipsel_24kc.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/alemprator-mtax/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/usr/bin/alemprator $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_c $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_f $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_l $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_m $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_m_l $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alemprator_s $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/alempratore $(1)/usr/bin/
endef

$(eval $(call BuildPackage,alemprator-mtax))