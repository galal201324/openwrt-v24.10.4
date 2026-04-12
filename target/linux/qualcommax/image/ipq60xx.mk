define Device/8devices_mango-dvk
	$(call Device/FitImageLzma)
	DEVICE_VENDOR := 8devices
	DEVICE_MODEL := Mango-DVK
	IMAGE_SIZE := 27776k
	BLOCKSIZE := 64k
	SOC := ipq6010
	SUPPORTED_DEVICES += 8devices,mango
	IMAGE/sysupgrade.bin := append-kernel | pad-to 64k | append-rootfs | pad-rootfs | check-size | append-metadata
	DEVICE_PACKAGES := ipq-wifi-8devices_mango
endef
TARGET_DEVICES += 8devices_mango-dvk

define Device/cambiumnetworks_xe3-4
       $(call Device/FitImage)
       $(call Device/UbiFit)
       DEVICE_VENDOR := Cambium Networks
       DEVICE_MODEL := XE3-4
       BLOCKSIZE := 128k
       PAGESIZE := 2048
       DEVICE_DTS_CONFIG := config@cp01-c3-xv3-4
       SOC := ipq6010
       DEVICE_PACKAGES := ipq-wifi-cambiumnetworks_xe34 ath11k-firmware-qcn9074 kmod-ath11k-pci
endef
TARGET_DEVICES += cambiumnetworks_xe3-4

define Device/kt_dv02-012h
  $(call Device/FitImage)
  $(call Device/UbiFit)
  DEVICE_VENDOR := KT
  DEVICE_MODEL := DV02-012H
  DEVICE_DTS := ipq6000-kt-dv02-012h
  BLOCKSIZE := 128k
  PAGESIZE := 2048
  DEVICE_DTS_CONFIG := config@cp03-c1
  SOC := ipq6000
  DEVICE_PACKAGES := ipq-wifi-kt_dv02-012h kmod-usb3 kmod-usb-dwc3 \
		kmod-usb-dwc3-qcom kmod-usb-storage kmod-ath11k-ahb kmod-gpio-button-hotplug
endef
TARGET_DEVICES += kt_dv02-012h

define Device/kt_ar06-012h
  $(call Device/FitImage)
  $(call Device/UbiFit)
  DEVICE_VENDOR := KT
  DEVICE_MODEL := AR06-012H
  DEVICE_DTS := ipq6000-kt-ar06-012h
  BLOCKSIZE := 128k
  PAGESIZE := 2048
  DEVICE_DTS_CONFIG := config@cp03-c1
  SOC := ipq6000
  DEVICE_PACKAGES := ipq-wifi-kt_ar06-012h kmod-usb3 kmod-usb-dwc3 \
		kmod-usb-dwc3-qcom kmod-usb-storage kmod-ath11k-ahb kmod-gpio-button-hotplug
endef
TARGET_DEVICES += kt_ar06-012h

define Device/kt_ar07-102h
  $(call Device/FitImage)
  $(call Device/UbiFit)
  DEVICE_VENDOR := KT
  DEVICE_MODEL := AR07-102H
  DEVICE_DTS := ipq6000-kt-ar07-102h
  BLOCKSIZE := 128k
  PAGESIZE := 2048
  DEVICE_DTS_CONFIG := config@cp03-c1
  SOC := ipq6000
  DEVICE_PACKAGES := ipq-wifi-kt_ar07-102h kmod-ath11k-ahb kmod-gpio-button-hotplug
endef
TARGET_DEVICES += kt_ar07-102h

define Device/lg_gapd-7500
	$(call Device/FitImage)
	$(call Device/UbiFit)
	DEVICE_VENDOR := LG
	DEVICE_MODEL := GAPD-7500
  DEVICE_DTS := ipq6000-lg-gapd-7500
	BLOCKSIZE := 128k
	PAGESIZE := 2048
	SOC := ipq6000
	DEVICE_DTS_CONFIG := config@cp03-c1
	DEVICE_PACKAGES := ipq-wifi-lg_gapd-7500 kmod-usb3 kmod-usb-dwc3 kmod-usb-dwc3-qcom kmod-usb-storage kmod-i2c-gpio kmod-ath11k-ahb kmod-phy-realtek kmod-dsa-rtl8365mb kmod-gpio-button-hotplug kmod-leds-gpio 
endef
TARGET_DEVICES += lg_gapd-7500

define Device/netgear_wax214
       $(call Device/FitImage)
       $(call Device/UbiFit)
       DEVICE_VENDOR := Netgear
       DEVICE_MODEL := WAX214
       BLOCKSIZE := 128k
       PAGESIZE := 2048
       DEVICE_DTS_CONFIG := config@cp03-c1
       SOC := ipq6010
       DEVICE_PACKAGES := ipq-wifi-netgear_wax214
endef
TARGET_DEVICES += netgear_wax214

define Device/yuncore_fap650
    $(call Device/FitImage)
    $(call Device/UbiFit)
    DEVICE_VENDOR := Yuncore
    DEVICE_MODEL := FAP650
    BLOCKSIZE := 128k
    PAGESIZE := 2048
    DEVICE_DTS_CONFIG := config@cp03-c1
    SOC := ipq6018
    DEVICE_PACKAGES := ipq-wifi-yuncore_fap650
    IMAGES := factory.ubi factory.ubin sysupgrade.bin
    IMAGE/factory.ubin := append-ubi | qsdk-ipq-factory-nand
endef
TARGET_DEVICES += yuncore_fap650

