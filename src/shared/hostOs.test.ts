import { describe, it, expect } from 'vitest'
import { parseOsProbe } from './hostOs'

const osRelease = (lines: string[]): string => [...lines, 'XSSH_UNAME=Linux'].join('\n')

describe('parseOsProbe', () => {
  it('recognizes the common distros from ID', () => {
    expect(parseOsProbe(osRelease(['NAME="Ubuntu"', 'ID=ubuntu', 'PRETTY_NAME="Ubuntu 26.04 LTS"']))).toEqual({
      id: 'ubuntu',
      pretty: 'Ubuntu 26.04 LTS'
    })
    expect(parseOsProbe(osRelease(['ID="centos"', 'PRETTY_NAME="CentOS Linux 7 (Core)"']))?.id).toBe('centos')
    expect(parseOsProbe(osRelease(['ID="rocky"', 'PRETTY_NAME="Rocky Linux 10.2"']))?.id).toBe('rocky')
    expect(parseOsProbe(osRelease(['ID=almalinux']))?.id).toBe('alma')
    expect(parseOsProbe(osRelease(['ID=debian']))?.id).toBe('debian')
  })

  it('tells DGX OS apart from the Ubuntu it is built on', () => {
    const out = ['ID=ubuntu', 'PRETTY_NAME="Ubuntu 24.04.3 LTS"', 'XSSH_DGX=1', 'XSSH_UNAME=Linux'].join('\n')
    expect(parseOsProbe(out)).toEqual({ id: 'dgx', pretty: 'Ubuntu 24.04.3 LTS' })
  })

  it('tells appliances apart from the distro they are built on', () => {
    const on = (marker: string): string => ['ID=debian', 'PRETTY_NAME="Debian GNU/Linux 12"', marker, 'XSSH_UNAME=Linux'].join('\n')
    expect(parseOsProbe(on('XSSH_PVE=1'))?.id).toBe('proxmox')
    expect(parseOsProbe(on('XSSH_TRUENAS=1'))?.id).toBe('truenas')
    expect(parseOsProbe(on('XSSH_OMV=1'))?.id).toBe('omv')
    expect(parseOsProbe(['ID=slackware', 'XSSH_UNRAID=1', 'XSSH_UNAME=Linux'].join('\n'))?.id).toBe('unraid')
    expect(parseOsProbe(['XSSH_SYNO=1', 'XSSH_UNAME=Linux'].join('\n'))?.id).toBe('synology')
  })

  it('knows the smaller distros by their own ID', () => {
    expect(parseOsProbe(osRelease(['ID=pop', 'ID_LIKE="ubuntu debian"']))?.id).toBe('popos')
    expect(parseOsProbe(osRelease(['ID=endeavouros', 'ID_LIKE=arch']))?.id).toBe('endeavouros')
    expect(parseOsProbe(osRelease(['ID="openEuler"']))?.id).toBe('huawei')
    expect(parseOsProbe(osRelease(['ID=alinux', 'ID_LIKE="rhel fedora centos anolis"']))?.id).toBe('alibaba')
    expect(parseOsProbe('XSSH_UNAME=VMkernel\n')?.id).toBe('vmware')
    expect(parseOsProbe('XSSH_UNAME=NetBSD\n')?.id).toBe('netbsd')
  })

  it('never gives a derivative its parent distro\'s logo', () => {
    const tencent = osRelease(['NAME="TencentOS Server"', 'ID="tencentos"', 'ID_LIKE="rhel fedora centos"', 'PRETTY_NAME="TencentOS Server 3.3 (Final)"'])
    expect(parseOsProbe(tencent)).toEqual({ id: 'linux', pretty: 'TencentOS Server 3.3 (Final)' })
    expect(parseOsProbe(osRelease(['ID="ol"', 'ID_LIKE="fedora"']))?.id).toBe('linux')
    expect(parseOsProbe(osRelease(['ID=linuxlite', 'ID_LIKE="ubuntu debian"']))?.id).toBe('linux')
  })

  it('treats an unknown os-release as generic Linux', () => {
    expect(parseOsProbe(osRelease(['ID=somethingnew', 'PRETTY_NAME="Something New 1"']))).toEqual({
      id: 'linux',
      pretty: 'Something New 1'
    })
  })

  it('reads redhat-release on systems older than os-release', () => {
    expect(parseOsProbe('XSSH_RELEASE=CentOS release 6.10 (Final)\nXSSH_UNAME=Linux\n')).toEqual({
      id: 'centos',
      pretty: 'CentOS release 6.10 (Final)'
    })
    expect(parseOsProbe('XSSH_RELEASE=Red Hat Enterprise Linux Server release 6.9 (Santiago)\nXSSH_UNAME=Linux\n')?.id).toBe('rhel')
  })

  it('uses uname when there is no os-release', () => {
    expect(parseOsProbe('XSSH_UNAME=Darwin\n')).toEqual({ id: 'macos', pretty: 'Darwin' })
    expect(parseOsProbe('XSSH_UNAME=FreeBSD\r\n')?.id).toBe('freebsd')
  })

  it('returns null for output it cannot read', () => {
    expect(parseOsProbe('')).toBeNull()
    expect(parseOsProbe("'cat' is not recognized as an internal or external command")).toBeNull()
    expect(parseOsProbe('XSSH_UNAME=\n')).toBeNull()
  })
})
